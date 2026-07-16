import { revokeInvite } from "@/lib/actions/team";
import type { TeamOverview } from "@/lib/portal-data";

import { InviteForm } from "./invite-form";

const ROLE_LABELS: Readonly<Record<string, string>> = {
  tenant_admin: "Administrador",
  tenant_operator: "Operador",
};

export function TeamSection({ team, isAdmin }: { team: TeamOverview; isAdmin: boolean }) {
  return (
    <section className="card" aria-labelledby="equipe" style={{ gridColumn: "1 / -1" }}>
      <h2 id="equipe" className="section-title">Equipe</h2>

      <div className="table-wrap" style={{ marginBottom: 18 }}>
        <div className="table-scroll">
          <table className="data">
            <thead>
              <tr>
                <th scope="col">Membro</th>
                <th scope="col">Papel</th>
                <th scope="col">Entrou em</th>
              </tr>
            </thead>
            <tbody>
              {team.members.map((member) => (
                <tr key={member.email}>
                  <td>
                    {member.email}
                    {member.is_you && (
                      <span className="badge badge-neutral" style={{ marginLeft: 8 }}>você</span>
                    )}
                  </td>
                  <td>
                    <span className={member.role === "tenant_admin" ? "badge badge-accent" : "badge badge-neutral"}>
                      {ROLE_LABELS[member.role] ?? member.role}
                    </span>
                  </td>
                  <td className="mono">{new Date(member.joined_at).toLocaleDateString("pt-BR")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {team.invites.length > 0 && (
        <>
          <h3 style={{ fontSize: "0.85rem", color: "var(--text-muted)", margin: "0 0 10px" }}>
            Convites pendentes
          </h3>
          <div className="table-wrap" style={{ marginBottom: 18 }}>
            <div className="table-scroll">
              <table className="data">
                <thead>
                  <tr>
                    <th scope="col">E-mail</th>
                    <th scope="col">Papel</th>
                    <th scope="col">Enviado em</th>
                    {isAdmin && <th scope="col"><span className="sr-only">Ações</span></th>}
                  </tr>
                </thead>
                <tbody>
                  {team.invites.map((invite) => (
                    <tr key={invite.id}>
                      <td>{invite.email}</td>
                      <td>
                        <span className="badge badge-warning">
                          {ROLE_LABELS[invite.role] ?? invite.role}
                        </span>
                      </td>
                      <td className="mono">{new Date(invite.created_at).toLocaleDateString("pt-BR")}</td>
                      {isAdmin && (
                        <td style={{ textAlign: "right" }}>
                          <form action={revokeInvite} style={{ display: "inline" }}>
                            <input type="hidden" name="invite_id" value={invite.id} />
                            <button type="submit" className="btn btn-ghost" style={{ padding: "4px 10px", fontSize: "0.78rem" }}>
                              Revogar
                            </button>
                          </form>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {isAdmin ? (
        <InviteForm />
      ) : (
        <p style={{ color: "var(--text-muted)", fontSize: "0.85rem", margin: 0 }}>
          Somente administradores podem convidar novos membros.
        </p>
      )}
    </section>
  );
}
