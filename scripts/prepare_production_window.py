#!/usr/bin/env python3
"""Prepara as migrations 0059 e 0069 a 0078 para aplicar no hospedado, com verificação de integridade.

    python3 scripts/prepare_production_window.py            # todas
    python3 scripts/prepare_production_window.py 0059       # só uma

Grava em artifacts/local/production-window/ (ignorado pelo git).

Para cada arquivo de database/supabase-only:
  1. separa em instruções de nível superior (respeita aspas, comentários e dollar-quotes);
  2. tira o begin; inicial e o commit; final;
  3. divide em partes de até BUDGET bytes, só entre instruções;
  4. para cada parte, calcula o md5 do corpo de cada função criada e gera um bloco DO que
     confere pg_proc.prosrc dentro da mesma transação (qualquer erro de cópia reverte tudo);
  5. grava apply/<nome>.sql pronto para o apply_migration.
"""
import hashlib
import re
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
ROOT = REPO / "database" / "supabase-only"
OUT = REPO / "artifacts" / "local" / "production-window"
BUDGET = 50_000
MIGRATIONS = ["0059", "0069", "0070", "0071", "0072", "0073", "0074", "0075", "0076", "0077", "0078"]
TAG = re.compile(r"\$[A-Za-z_][A-Za-z0-9_]*\$|\$\$")


def split_statements(text):
    """Devolve [(inicio, fim)] de cada instrução de nível superior, fim logo depois do ';'."""
    spans, i, n, start = [], 0, len(text), 0
    while i < n:
        c = text[i]
        if c == "-" and text.startswith("--", i):
            j = text.find("\n", i)
            i = n if j == -1 else j + 1
        elif c == "/" and text.startswith("/*", i):
            j = text.find("*/", i + 2)
            i = n if j == -1 else j + 2
        elif c == "'":
            i += 1
            while i < n:
                if text[i] == "'":
                    if i + 1 < n and text[i + 1] == "'":
                        i += 2
                        continue
                    break
                i += 1
            i += 1
        elif c == "$":
            m = TAG.match(text, i)
            if m:
                tag = m.group(0)
                j = text.find(tag, m.end())
                if j == -1:
                    raise SystemExit(f"dollar-quote nao fechado em {i}")
                i = j + len(tag)
            else:
                i += 1
        elif c == ";":
            i += 1
            spans.append((start, i))
            start = i
        else:
            i += 1
    if text[start:].strip():
        spans.append((start, n))
    return spans


FUNC_HEAD = re.compile(r"^\s*(?:--[^\n]*\n\s*)*create\s+(?:or\s+replace\s+)?function\s+([A-Za-z0-9_\"\.]+)\s*\(", re.I)
TABLE_HEAD = re.compile(r"^\s*(?:--[^\n]*\n\s*)*create\s+(?:unlogged\s+)?table\s+(?:if\s+not\s+exists\s+)?([A-Za-z0-9_\"\.]+)", re.I)


def head_of(stmt):
    """O comentário que antecede a instrução não faz parte dela; tira para casar o cabeçalho."""
    s = stmt
    while True:
        t = s.lstrip()
        if t.startswith("--"):
            nl = t.find("\n")
            s = "" if nl == -1 else t[nl + 1:]
        elif t.startswith("/*"):
            j = t.find("*/")
            s = "" if j == -1 else t[j + 2:]
        else:
            return t


def signature_key(stmt, name):
    """name + argumentos até o parêntese que fecha, normalizado: distingue sobrecargas."""
    t = head_of(stmt)
    k = t.lower().find(name.lower())
    p = t.find("(", k)
    depth, j = 0, p
    while j < len(t):
        if t[j] == "(":
            depth += 1
        elif t[j] == ")":
            depth -= 1
            if depth == 0:
                break
        j += 1
    return name.lower().replace('"', "") + "(" + re.sub(r"\s+", " ", t[p + 1:j].strip().lower()) + ")"


def function_body(stmt):
    """Corpo entre as aspas de dólar: é exatamente o pg_proc.prosrc."""
    t = head_of(stmt)
    first = None
    i = 0
    depth = 0
    while i < len(t):
        c = t[i]
        if c == "'":
            i += 1
            while i < len(t) and not (t[i] == "'" and not t.startswith("''", i)):
                i += 2 if t.startswith("''", i) else 1
            i += 1
            continue
        if c == "$":
            m = TAG.match(t, i)
            if m:
                first = m
                break
        i += 1
    if first is None:
        return None
    tag = first.group(0)
    end = t.find(tag, first.end())
    return t[first.end():end]


CONSTRAINT_WORDS = {"primary", "unique", "foreign", "check", "constraint", "like", "exclude"}


def table_columns(stmt):
    """Nomes das colunas, na ordem, de um create table (None se nao for possivel ler com seguranca)."""
    t = head_of(stmt)
    i = t.find("(")
    if i == -1:
        return None
    depth, j, start, items = 0, i, i + 1, []
    while j < len(t):
        c = t[j]
        if c == "'":
            j += 1
            while j < len(t) and not (t[j] == "'" and not t.startswith("''", j)):
                j += 2 if t.startswith("''", j) else 1
        elif c == "(":
            depth += 1
        elif c == ")":
            depth -= 1
            if depth == 0:
                items.append(t[start:j])
                break
        elif c == "," and depth == 1:
            items.append(t[start:j])
            start = j + 1
        j += 1
    cols = []
    for item in items:
        body = head_of(item).strip()
        if not body:
            continue
        first = re.split(r"[\s(]", body, maxsplit=1)[0].strip('"').lower()
        if first in CONSTRAINT_WORDS:
            continue
        cols.append(first)
    return cols


CATALOG_ROW = re.compile(r"\('([a-z0-9_]+)','([a-z_]+)',(null|'[^']*'),'([a-z0-9_]+)','([a-z_]+)',(true|false),(true|false),(\d+)\)")


def catalog_rows(stmts):
    rows = []
    for stmt in stmts:
        h = head_of(stmt)
        if re.match(r"insert\s+into\s+public\.data_governance_resource_catalog\s*\(", h, re.I):
            for m in CATALOG_ROW.finditer(h):
                code, surface, rel, gen, action, link, ret, order = m.groups()
                rel = "" if rel == "null" else rel.strip("'")
                rows.append((int(order), code, f"{code}|{surface}|{rel}|{gen}|{action}|{link}|{ret}|{order}"))
    rows.sort()
    return rows


def qualify(name):
    n = name.replace('"', "")
    if "." not in n:
        raise SystemExit(f"funcao sem schema: {name}")
    s, f = n.split(".", 1)
    return s, f


def integrity_block(stmts):
    funcs, tables = {}, []
    for stmt in stmts:
        h = head_of(stmt)
        m = FUNC_HEAD.match(h)
        if m:
            body = function_body(stmt)
            if body is None:
                print(f"AVISO: funcao sem corpo em dollar-quote: {m.group(1)}", file=sys.stderr)
                continue
            s, f = qualify(m.group(1))
            funcs[signature_key(stmt, m.group(1))] = (s, f, hashlib.md5(body.encode("utf-8")).hexdigest())
            continue
        m = TABLE_HEAD.match(h)
        if m:
            s, t = qualify(m.group(1))
            tables.append(f"{s}.{t}")
    rows = sorted(set(funcs.values()))
    cat = catalog_rows(stmts)
    lines = ["-- Bloco de integridade (nao faz parte do arquivo do repositorio): confere, na mesma transacao,",
             "-- que cada corpo de funcao gravado tem o md5 calculado direto do arquivo. Qualquer divergencia reverte tudo.",
             "do $integrity$", "declare r record;", "begin"]
    if rows:
        lines.append("  for r in select * from (values")
        lines.append(",\n".join(f"    ('{s}','{f}','{h}')" for s, f, h in rows))
        lines.append("  ) as t(s,f,h) loop")
        lines.append("    if not exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace")
        lines.append("                   where n.nspname=r.s and p.proname=r.f and md5(p.prosrc)=r.h) then")
        lines.append("      raise exception 'integrity: function body mismatch for %.%', r.s, r.f;")
        lines.append("    end if;")
        lines.append("  end loop;")
    for stmt in stmts:
        m = TABLE_HEAD.match(head_of(stmt))
        if not m:
            continue
        s_, t_ = qualify(m.group(1))
        cols = table_columns(stmt)
        if cols is None:
            print(f"AVISO: colunas de {s_}.{t_} nao lidas", file=sys.stderr)
            lines.append(f"  if to_regclass('{s_}.{t_}') is null then raise exception 'integrity: table {s_}.{t_} missing'; end if;")
            continue
        arr = ",".join(f"'{c}'" for c in cols)
        # Prefixo, nao igualdade: um alter table add column do mesmo arquivo acrescenta colunas ao fim.
        lines.append(
            f"  if (select (array_agg(a.attname::text order by a.attnum))[1:{len(cols)}] from pg_attribute a "
            f"where a.attrelid=to_regclass('{s_}.{t_}') and a.attnum>0 and not a.attisdropped) "
            f"is distinct from array[{arr}]::text[] then raise exception 'integrity: columns of {s_}.{t_} differ'; end if;"
        )
    if cat:
        expected = hashlib.md5("\n".join(r[2] for r in cat).encode("utf-8")).hexdigest()
        codes = ",".join(f"'{r[1]}'" for r in cat)
        lines.append(
            "  if (select md5(string_agg(resource_code||'|'||surface||'|'||coalesce(relation_name,'')||'|'||catalog_generation||'|'||"
            "default_action||'|'||subject_link_required::text||'|'||retained_exception::text||'|'||inventory_order::text, E'\\n' order by inventory_order)) "
            f"from public.data_governance_resource_catalog where resource_code = any(array[{codes}])) "
            f"is distinct from '{expected}' then raise exception 'integrity: catalog rows differ'; end if;"
        )
        lines.append(
            f"  if (select count(*) from public.data_governance_resource_catalog where resource_code = any(array[{codes}])) <> {len(cat)} "
            f"then raise exception 'integrity: catalog row count differs'; end if;"
        )
    lines.append("end $integrity$;")
    return "\n".join(lines) + "\n", len(rows), len(set(tables))


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    for old in OUT.glob("*.sql"):
        if not sys.argv[1:] or any(old.name.startswith(n) for n in sys.argv[1:]):
            old.unlink()
    manifest = []
    selected = sys.argv[1:] or MIGRATIONS
    for num in selected:
        path = next(ROOT.glob(f"{num}_*.sql"))
        text = path.read_text(encoding="utf-8")
        spans = split_statements(text)
        stmts = [text[a:b] for a, b in spans]
        # begin; inicial e commit; final
        first_real = next(i for i, s in enumerate(stmts) if re.fullmatch(r"\s*begin\s*;\s*", head_of(s), re.I))
        last_real = max(i for i, s in enumerate(stmts) if re.fullmatch(r"\s*commit\s*;\s*", head_of(s), re.I))
        assert last_real == len(stmts) - 1, f"{path.name}: commit nao e a ultima instrucao"
        # o texto antes do begin; (cabecalho em comentario) acompanha a primeira instrucao do corpo
        header = "".join(stmts[:first_real])
        body = stmts[first_real + 1:last_real]
        trailer = stmts[last_real]
        total = sum(len(s.encode("utf-8")) for s in body) + len(header.encode("utf-8"))
        if total <= BUDGET * 1.2:
            parts = [body]
        else:
            parts, cur, size = [], [], 0
            for s in body:
                sz = len(s.encode("utf-8"))
                if cur and size + sz > BUDGET:
                    parts.append(cur)
                    cur, size = [], 0
                cur.append(s)
                size += sz
            if cur:
                parts.append(cur)
        for idx, part in enumerate(parts, 1):
            block, nf, nt = integrity_block(part)
            label = path.stem if len(parts) == 1 else f"{path.stem}_part{idx}of{len(parts)}"
            lead = header if idx == 1 else ""
            sql = lead + "begin;\n" + "".join(part) + ("" if "".join(part).endswith("\n") else "\n") + "\n" + block + "\ncommit;\n"
            (OUT / f"{label}.sql").write_text(sql, encoding="utf-8")
            manifest.append((label, len(sql.encode("utf-8")), nf, nt, hashlib.md5(sql.encode("utf-8")).hexdigest()))
    print(f"{'arquivo':72} {'bytes':>8} {'funcoes':>8} {'tabelas':>8}  md5")
    for label, size, nf, nt, h in manifest:
        print(f"{label:72} {size:>8} {nf:>8} {nt:>8}  {h}")


if __name__ == "__main__":
    main()
