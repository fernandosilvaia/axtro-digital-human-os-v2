import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";

const directory = new URL("../../apps/portal/src/app/(app)/agentes/[id]/testar/", import.meta.url);
const tenantId = "019f0000-0000-7000-8000-000000000001";
const agentId = "019f0000-0000-7000-8000-000000000002";
const deck = { title: "Synthetic deck", slides: [{ kind: "cover", title: "One", bullets: [] }, {kind: "next", title: "Two", bullets: []}] };
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return {promise, resolve, reject}; };
const flush = async () => { for (let index = 0; index < 24; index++) await Promise.resolve(); };
const effect = (remoteEffect = "committed") => ({schema_version: "2.0.0", remoteEffect});
function storage(values = new Map()) { return {values, getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: (key) => values.delete(key)}; }
function recoveryKey(tenant = tenantId, mode = "video") { return `axtro:call:${tenant}:${agentId}:${mode}`; }

/** Replay the production TSX and shared hook. No timers, renderer dependency or network. */
function harness(mode, options = {}) {
  const bridge = options.bridge ?? {};
  const hooks = [], nodes = new Map(), effects = [];
  let index = 0, dirty = false, mounted = true, tree, commands = 0;
  const stored = options.storage ?? storage();
  const state = { calls: [], starts: [], stops: [], dispatches: [], imports: 0, logs: [], timers: [], registry: new Set(), tree: () => tree, stored };
  // Deterministic timers: nothing fires on its own, the test decides when the wait expires.
  state.fireTimers = () => { const due = state.timers.splice(0); for (const timer of due) if (!timer.cleared) timer.callback(); };
  let props = {tenantId, agentId, agentName: "Synthetic agent", ...options.props};
  const same = (left, right) => left && right && left.length === right.length && left.every((entry, position) => Object.is(entry, right[position]));
  const react = {
    useState(initial) {
      const position = index++;
      hooks[position] ??= {value: typeof initial === "function" ? initial() : initial};
      return [hooks[position].value, (value) => { const next = typeof value === "function" ? value(hooks[position].value) : value; if (!Object.is(next, hooks[position].value)) { hooks[position].value = next; dirty = true; } }];
    },
    useRef(value) { const position = index++; hooks[position] ??= {current: value}; return hooks[position]; },
    useCallback(callback, dependencies) { const position = index++; if (!same(hooks[position]?.deps, dependencies)) hooks[position] = {value: callback, deps: dependencies}; return hooks[position].value; },
    useEffect(callback, dependencies) { const position = index++; if (!same(hooks[position]?.deps, dependencies)) { const previous = hooks[position]; hooks[position] = {deps: dependencies, cleanup: previous?.cleanup}; effects.push(() => { previous?.cleanup?.(); hooks[position].cleanup = callback(); }); } },
  };
  const jsx = (type, props) => ({type, props: props ?? {}});
  const all = (node) => !node || typeof node !== "object" ? (typeof node === "string" ? [node] : []) : Array.isArray(node) ? node.flatMap(all) : [node, ...all(node.props?.children)];
  const daily = {createCallObject() {
    if (options.createThrows) throw new Error("Synthetic create failure");
    if (options.strictRegistry && state.registry.size > 0) throw new Error("Duplicate DailyIframe instances are not allowed");
    const handlers = new Map();
    const call = {handlers, messages: [], leaves: 0, destroys: 0,
      on: (name, handler) => {if (options.onThrows) throw new Error("Synthetic event subscription failure"); handlers.set(name, handler);},
      emit: (name, event = {}) => handlers.get(name)?.(event),
      join() { options.onJoin?.(call); return options.join?.promise ?? Promise.resolve(); },
      leave() { call.leaves++; return options.leave?.promise ?? Promise.resolve(); },
      destroy() {
        call.destroys++;
        if (!options.strictRegistry) return options.destroy?.promise ?? Promise.resolve();
        // daily-js 0.91: destroy() awaits leave() and only then frees the global registry entry.
        return (async () => { try { await (options.leave?.promise ?? Promise.resolve()); } catch { /* leave errors are swallowed */ } state.registry.delete(call); })();
      },
      sendAppMessage(message) { call.messages.push(message); },
      setLocalAudio() {},
    };
    state.calls.push(call);
    if (options.strictRegistry) state.registry.add(call);
    return call;
  }};
  const actions = {
    async startVideoConversation(...args) { state.starts.push(args); state.logs.push("start"); assert.equal(stored.getItem(recoveryKey(props.tenantId, mode)), args[1], "opaque command must be persisted before dispatch"); return options.start?.(...args) ?? {url: "https://tavus.daily.co/synthetic", conversationId: `conversation-${state.starts.length}`, effect: effect(), error: null, ...(mode === "presentation" ? {deck} : {})}; },
    async stopVideoConversation(...args) { state.stops.push(args); return options.stop?.(...args) ?? {stopped: true, error: null}; },
  };
  actions.startPresentationConversation = actions.startVideoConversation;
  actions.stopPresentationConversation = actions.stopVideoConversation;
  const context = vm.createContext({
    window: {get sessionStorage() { if (options.storageAccessError) throw new Error("Synthetic unavailable storage"); return stored; }},
    crypto: {randomUUID: () => `00000000-0000-4000-8000-${String(++commands).padStart(12, "0")}`},
    MediaStream: class {constructor(tracks) { this.tracks = tracks; }},
    setTimeout: (callback) => { const timer = {callback, cleared: false}; state.timers.push(timer); return timer; },
    clearTimeout: (timer) => { if (timer) timer.cleared = true; },
    loadDailyForTest: () => { state.imports++; return options.importDaily?.promise ?? Promise.resolve({default: daily}); },
  });
  const cache = new Map();
  function load(file) {
    if (file === "call-lifecycle.ts" && options.sharedModules?.has(file)) return options.sharedModules.get(file);
    if (cache.has(file)) return cache.get(file);
    const output = ts.transpileModule(readFileSync(new URL(file, directory), "utf8").replace('import("@daily-co/daily-js")', "loadDailyForTest()"), {
      fileName: file, compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX},
    }).outputText;
    const module = {exports: {}};
    const require = (name) => {
      if (name === "react") return Object.fromEntries(Object.keys(react).map((method) => [method, (...args) => bridge.react[method](...args)]));
      if (name === "react/jsx-runtime") return {jsx, jsxs: jsx, Fragment: "fragment"};
      if (name === "@axtro/provider-tavus") return {isTrustedTavusConversationUrl: (url) => url === "https://tavus.daily.co/synthetic"};
      if (name === "@/lib/actions/video-conversation") return actions;
      if (name === "@/lib/runtime/tool-call-names") return {classifyToolCallName: (name) => name === "register_lead" ? "business_action" : name === "next_slide" ? "scene" : "unknown"};
      if (name === "./tool-call-dispatcher") return {dispatchToolCall(args) { state.dispatches.push(args); return options.tool?.promise ?? Promise.resolve({toolCallId: "tool", output: "Receipt confirmed", status: "success"}); }};
      if (name === "./call-lifecycle") return load("call-lifecycle.ts");
      throw new Error(`Unmocked module ${name}`);
    };
    new vm.Script(`(function(require,module,exports){${output}\n})`).runInContext(context)(require, module, module.exports);
    cache.set(file, module.exports);
    if (file === "call-lifecycle.ts") options.sharedModules?.set(file, module.exports);
    return module.exports;
  }
  const Component = mode === "video" ? load("video-call.tsx").VideoCall : load("presentation-room.tsx").PresentationRoom;
  const render = () => {
    if (!mounted) return;
    for (let rounds = 0; rounds < 20; rounds++) {
      dirty = false; index = 0; bridge.react = react; tree = Component(props);
      const visible = new Set();
      for (const item of all(tree)) {
        if (!item.props?.ref || !["video", "audio"].includes(item.type)) continue;
        const key = `${item.type}:${item.props["aria-label"] ?? "audio"}`;
        visible.add(key);
        let node = nodes.get(key);
        if (!node) {
          node = {srcObject: null, ref: item.props.ref};
          nodes.set(key, node); node.ref(node);
        } else if (node.ref !== item.props.ref) {
          node.ref(null); node.ref = item.props.ref; node.ref(node);
        }
      }
      for (const [key, node] of nodes) if (!visible.has(key)) { node.ref(null); nodes.delete(key); }
      while (effects.length) effects.shift()();
      if (!dirty) return;
    }
    throw new Error("Unstable synthetic render");
  };
  state.render = render;
  state.nodes = nodes;
  state.text = () => all(tree).filter((item) => typeof item === "string").join(" ");
  state.buttons = () => all(tree).filter((item) => item.type === "button");
  state.button = (text) => state.buttons().find((item) => text.test(typeof item.props.children === "string" ? item.props.children : ""));
  state.click = (text) => { const button = state.button(text); assert.ok(button, `button missing: ${text} (${state.text()})`); assert.equal(Boolean(button.props.disabled), false, "button disabled"); button.props.onClick(); render(); };
  state.consent = () => { for (let position = 0; position < 5; position++) { all(tree).filter((item) => item.type === "input")[position].props.onChange({target: {checked: true}}); render(); } };
  state.start = async () => { state.consent(); state.click(/^Iniciar/); await flush(); render(); };
  state.unmount = () => { mounted = false; for (const hook of hooks) hook?.cleanup?.(); for (const node of nodes.values()) node.ref(null); nodes.clear(); };
  state.rerender = (nextProps) => { props = {...props, ...nextProps}; render(); };
  state.settle = async () => { await flush(); render(); };
  render();
  return state;
}
function toolMessage(conversation = "conversation-1", name = "register_lead") { return {data: {message_type: "conversation", event_type: "conversation.tool_call", conversation_id: conversation, properties: {name, tool_call_id: "tool"}}}; }

for (const mode of ["video", "presentation"]) {
  test(`${mode}: early local video, remote video and audio bind after live refs mount, stopped tracks detach`, async () => {
    const tracks = [{id: "local", kind: "video"}, {id: "remote", kind: "video"}, {id: "audio", kind: "audio"}];
    const h = harness(mode, {onJoin(call) { for (const track of tracks) call.emit("track-started", {track, participant: {local: track.id === "local"}}); }});
    await h.start();
    assert.equal(h.nodes.size, 3);
    assert.deepEqual([...h.nodes.values()].map((node) => node.srcObject.tracks[0].id).sort(), ["audio", "local", "remote"]);
    h.calls[0].emit("track-stopped", {track: tracks[1]});
    assert.equal(h.nodes.get("video:Vídeo de Synthetic agent").srcObject, null);
    h.unmount(); await flush();
    assert.equal(h.calls[0].destroys, 1); assert.equal(h.stops.length, 0);
  });
  test(`${mode}: tracks after live bind without rerender and stopped replacements stay attached`, async () => {
    const h = harness(mode); await h.start(); const call = h.calls[0];
    const oldVideo = {id: "old-video", kind: "video"}, newVideo = {id: "new-video", kind: "video"};
    const oldAudio = {id: "old-audio", kind: "audio"}, newAudio = {id: "new-audio", kind: "audio"};
    const video = h.nodes.get("video:Vídeo de Synthetic agent"), audio = h.nodes.get("audio:audio");
    call.emit("track-started", {track: oldVideo}); call.emit("track-started", {track: oldAudio});
    assert.equal(video.srcObject.tracks[0], oldVideo); assert.equal(audio.srcObject.tracks[0], oldAudio);
    call.emit("track-started", {track: newVideo}); call.emit("track-started", {track: newAudio});
    call.emit("track-stopped", {track: oldVideo}); call.emit("track-stopped", {track: oldAudio});
    assert.equal(video.srcObject.tracks[0], newVideo); assert.equal(audio.srcObject.tracks[0], newAudio);
    call.emit("track-stopped", {track: newAudio}); assert.equal(audio.srcObject, null); h.unmount();
  });
  test(`${mode}: current business tool result uses captured command and conversation`, async () => {
    const h = harness(mode); await h.start(); h.calls[0].emit("app-message", toolMessage()); await h.settle();
    assert.equal(h.dispatches[0].agentId, agentId); assert.equal(h.dispatches[0].commandId, h.starts[0][1]); assert.equal(h.dispatches[0].mode, mode);
    assert.equal(h.calls[0].messages[0].conversation_id, "conversation-1"); assert.equal(h.calls[0].messages[0].properties.status, "success"); assert.equal(h.calls[0].messages[0].properties.tool_call_id, "tool"); h.unmount();
  });
  test(`${mode}: current captured call accepts an omitted conversation label and responds with its own identity`, async () => {
    const h = harness(mode); await h.start();
    const message = toolMessage(); delete message.data.conversation_id;
    h.calls[0].emit("app-message", message); await h.settle();
    assert.equal(h.dispatches.length, 1); assert.equal(h.dispatches[0].agentId, agentId);
    assert.equal(h.dispatches[0].commandId, h.starts[0][1]); assert.equal(h.dispatches[0].mode, mode);
    assert.equal(h.calls[0].messages[0].conversation_id, "conversation-1");
    assert.equal(h.calls[0].messages[0].properties.tool_call_id, "tool");
    assert.equal(h.calls[0].messages[0].properties.status, "success"); h.unmount();
  });
  test(`${mode}: immediate double start and stop fire each server action only once`, async () => {
    const h = harness(mode); h.consent(); const start = h.button(/^Iniciar/).props.onClick;
    start(); start(); await h.settle(); assert.equal(h.starts.length, 1); assert.equal(h.calls.length, 1);
    const end = h.button(/^Encerrar$/).props.onClick; end(); end(); await h.settle();
    assert.equal(h.stops.length, 1); assert.equal(h.calls[0].destroys, 1); h.unmount();
  });
  for (const boundary of ["start", "join"]) test(`${mode}: authenticated tenant changes during pending ${boundary} invalidate old continuations`, async () => {
    const pending = deferred(), h = harness(mode, boundary === "start" ? {start: () => pending.promise} : {join: pending});
    await h.start();
    const otherTenant = "019f0000-0000-7000-8000-000000000099"; h.rerender({tenantId: otherTenant});
    if (boundary === "start") pending.resolve({url: "https://tavus.daily.co/synthetic", conversationId: "late-A", deck, effect: effect(), error: null}); else pending.resolve();
    await h.settle(); assert.ok(h.button(/^Iniciar/)); assert.equal(h.stops.length, 0); assert.ok(h.stored.getItem(recoveryKey(tenantId, mode)));
    if (boundary === "start") assert.equal(h.calls.length, 0); else assert.equal(h.calls[0].destroys, 1);
    h.unmount();
  });
  test(`${mode}: old tool success and old events cannot reach a new call`, async () => {
    const tool = deferred(), h = harness(mode, {tool}); await h.start();
    const old = h.calls[0]; old.emit("app-message", toolMessage());
    h.click(/^Encerrar$/); await h.settle(); h.click(/^Nova/); await h.start();
    const current = h.calls[1];
    const currentTrack = {id: "current-B", kind: "video"};
    current.emit("track-started", {track: currentTrack});
    const currentVideo = h.nodes.get("video:Vídeo de Synthetic agent");
    const streamB = currentVideo.srcObject;
    tool.resolve({toolCallId: "tool", output: "Old success", status: "success"}); await h.settle();
    old.emit("left-meeting"); old.emit("app-message", toolMessage()); old.emit("track-started", {track: {id: "stale", kind: "video"}}); old.emit("track-stopped", {track: currentTrack});
    assert.equal(currentVideo.srcObject, streamB); assert.equal(currentVideo.srcObject.tracks[0], currentTrack);
    assert.equal(current.messages.length, 0); assert.equal(old.messages.length, 0); assert.equal(h.dispatches.length, 1);
    assert.ok(h.button(/^Encerrar$/)); assert.equal(current.destroys, 0); h.unmount();
  });
  test(`${mode}: current tool rejection yields only an error, wrong conversation and scene do not execute`, async () => {
    const tool = deferred(), h = harness(mode, {tool}); await h.start(); const call = h.calls[0];
    call.emit("app-message", toolMessage("other-conversation")); assert.equal(h.dispatches.length, 0);
    call.emit("app-message", toolMessage("conversation-1", "next_slide")); assert.equal(h.dispatches.length, 0); assert.equal(call.messages[0].properties.status, "error");
    call.emit("app-message", toolMessage()); tool.reject(new Error("Synthetic transport failure")); await h.settle();
    assert.equal(call.messages[1].properties.status, "error"); assert.equal(call.messages[1].conversation_id, "conversation-1"); h.unmount();
  });
  test(`${mode}: stale tool rejection after unmount is handled and sends nothing`, async () => {
    const tool = deferred(), h = harness(mode, {tool}); await h.start(); h.calls[0].emit("app-message", toolMessage());
    h.unmount(); tool.reject(new Error("Synthetic late rejection")); await flush(); assert.equal(h.calls[0].messages.length, 0);
  });
  test(`${mode}: unmount during pending start preserves recovery and never imports or joins`, async () => {
    const pending = deferred(), shared = storage(), h = harness(mode, {storage: shared, start: () => pending.promise}); await h.start(); h.unmount();
    pending.resolve({url: "https://tavus.daily.co/synthetic", conversationId: "late", deck, effect: effect(), error: null}); await flush();
    assert.equal(h.imports, 0); assert.equal(h.calls.length, 0); assert.ok(shared.getItem(recoveryKey(tenantId, mode)));
    const restored = harness(mode, {storage: shared}); assert.ok(restored.button(/^Tentar encerrar/)); assert.equal(restored.starts.length, 0);
    restored.click(/^Tentar encerrar/); await restored.settle(); assert.equal(restored.stops[0][1], h.starts[0][1]); assert.equal(shared.getItem(recoveryKey(tenantId, mode)), null); restored.unmount();
  });
  test(`${mode}: remount before a late proven denial releases only the matching recovery owner`, async () => {
    const pending = deferred(), stored = storage(), sharedModules = new Map(), bridge = {};
    const old = harness(mode, {storage: stored, start: () => pending.promise, sharedModules, bridge});
    await old.start(); old.unmount();
    const restored = harness(mode, {storage: stored, sharedModules, bridge});
    assert.ok(restored.button(/^Tentar encerrar/));
    pending.resolve({url: null, conversationId: null, deck: null, effect: effect("not_started"), error: "Denied"});
    await restored.settle();
    assert.ok(restored.button(/^Iniciar/)); assert.equal(restored.stops.length, 0); assert.equal(restored.starts.length, 0); assert.equal(stored.values.size, 0); restored.unmount();
  });
  test(`${mode}: unmount during import prevents Daily creation`, async () => {
    const importDaily = deferred(), h = harness(mode, {importDaily}); await h.start(); assert.equal(h.imports, 1); h.unmount();
    let created = 0; importDaily.resolve({default: {createCallObject() {created++;}}}); await flush(); assert.equal(created, 0); assert.equal(h.stops.length, 0);
  });
  test(`${mode}: rejected import keeps explicit stop recovery without Daily`, async () => {
    const importDaily = deferred(), h = harness(mode, {importDaily}); await h.start(); importDaily.reject(new Error("Synthetic import failed")); await h.settle();
    assert.equal(h.calls.length, 0); assert.ok(h.button(/^Tentar encerrar/)); assert.equal(h.stored.values.size, 1); h.unmount();
  });
  test(`${mode}: unmount during join disposes once even when leave never settles`, async () => {
    const join = deferred(), leave = deferred(), h = harness(mode, {join, leave}); await h.start(); h.unmount(); await flush();
    assert.equal(h.calls[0].leaves, 1); assert.equal(h.calls[0].destroys, 1);
    join.resolve(); await flush(); assert.equal(h.calls[0].destroys, 1); assert.equal(h.stops.length, 0);
  });
  for (const point of ["create", "on"]) test(`${mode}: Daily ${point} failure preserves recovery and cleans any partial object`, async () => {
    const h = harness(mode, {[`${point}Throws`]: true}); await h.start();
    assert.ok(h.button(/^Tentar encerrar/)); assert.ok(h.stored.getItem(recoveryKey(tenantId, mode)));
    if (point === "create") assert.equal(h.calls.length, 0); else {assert.equal(h.calls[0].leaves, 1); assert.equal(h.calls[0].destroys, 1);}
    h.unmount(); await flush(); if (point === "on") assert.equal(h.calls[0].destroys, 1);
  });
  test(`${mode}: rejected local leave and destroy do not discard remote recovery`, async () => {
    const leave = deferred(), destroy = deferred(), h = harness(mode, {leave, destroy}); await h.start();
    h.calls[0].emit("left-meeting"); leave.reject(new Error("Synthetic leave failure")); destroy.reject(new Error("Synthetic destroy failure")); await h.settle();
    assert.ok(h.button(/^Tentar encerrar/)); assert.ok(h.stored.getItem(recoveryKey(tenantId, mode))); assert.equal(h.stops.length, 0); assert.equal(h.calls[0].destroys, 1); h.unmount();
  });
  test(`${mode}: rejected join cleans partial Daily object and preserves explicit stop`, async () => {
    const join = deferred(), h = harness(mode, {join}); await h.start(); join.reject(new Error("Synthetic join rejection")); await h.settle();
    assert.equal(h.calls[0].leaves, 1); assert.equal(h.calls[0].destroys, 1); assert.ok(h.button(/^Tentar encerrar/)); assert.ok(h.stored.getItem(recoveryKey(tenantId, mode)));
    h.click(/^Tentar encerrar/); await h.settle(); assert.equal(h.calls[0].destroys, 1); assert.equal(h.stored.getItem(recoveryKey(tenantId, mode)), null); h.unmount();
  });
  test(`${mode}: pending stop after unmount cannot mutate a new recovery owner or create another call`, async () => {
    const stop = deferred(), shared = storage(), h = harness(mode, {storage: shared, stop: () => stop.promise}); await h.start();
    h.click(/^Encerrar$/); h.unmount(); const restored = harness(mode, {storage: shared});
    stop.resolve({stopped: true, error: null}); await restored.settle();
    assert.ok(restored.button(/^Tentar encerrar/)); assert.equal(restored.starts.length, 0); assert.ok(shared.getItem(recoveryKey(tenantId, mode)));
    restored.click(/^Tentar encerrar/); await restored.settle(); assert.equal(restored.stops[0][1], h.starts[0][1]); assert.equal(shared.values.size, 0); restored.unmount();
  });
  test(`${mode}: failed storage cleanup preserves stop retry even after server acceptance`, async () => {
    const stored = storage(), remove = stored.removeItem; stored.removeItem = () => {throw new Error("Synthetic storage removal denied");};
    const h = harness(mode, {storage: stored}); await h.start(); h.click(/^Encerrar$/); await h.settle();
    assert.ok(stored.getItem(recoveryKey(tenantId, mode))); assert.ok(h.button(/^Encerrar$/)); assert.equal(h.button(/^Nova/), undefined); assert.equal(h.calls[0].destroys, 0);
    stored.removeItem = remove; h.click(/^Encerrar$/); await h.settle(); assert.equal(stored.values.size, 0); assert.equal(h.calls[0].destroys, 1); h.unmount();
  });
  test(`${mode}: a marker created after mount is recovered rather than overwritten`, async () => {
    const stored = storage(), h = harness(mode, {storage: stored}); h.consent();
    const command = "00000000-0000-4000-8000-000000000999"; stored.setItem(recoveryKey(tenantId, mode), command);
    h.click(/^Iniciar/); await h.settle(); assert.equal(h.starts.length, 0); assert.ok(h.button(/^Tentar encerrar/)); assert.equal(stored.getItem(recoveryKey(tenantId, mode)), command); h.unmount();
  });
  for (const outcome of ["false", "reject"]) test(`${mode}: ${outcome} stop with left-meeting retains retry and blocks new calls`, async () => {
    const stop = deferred(), h = harness(mode, {stop: () => stop.promise}); await h.start(); h.click(/^Encerrar$/); h.calls[0].emit("left-meeting");
    if (outcome === "false") stop.resolve({stopped: false, error: "Synthetic refusal"}); else stop.reject(new Error("Synthetic lost response"));
    await h.settle(); assert.ok(h.button(/^Tentar encerrar/)); assert.equal(h.button(/^Nova|^Iniciar/), undefined); assert.ok(h.stored.getItem(recoveryKey(tenantId, mode))); assert.equal(h.calls[0].destroys, 1); h.unmount();
  });
  test(`${mode}: accepted stop cleans once and only claims request acceptance`, async () => {
    const h = harness(mode); await h.start(); h.click(/^Encerrar$/); await h.settle();
    assert.equal(h.calls[0].destroys, 1); assert.equal(h.calls[0].leaves, 1); assert.equal(h.stored.values.size, 0); assert.match(h.text(), /confirmou o pedido/); h.unmount(); assert.equal(h.calls[0].destroys, 1);
  });
  for (const classification of ["possible", "missing", "wrong-version", "extra-field", "invalid-url", "possible-valid-url", "missing-valid-url", "network"]) test(`${mode}: ${classification} start preserves opaque command and recovery`, async () => {
    const h = harness(mode, {start: async () => {
      if (classification === "network") throw new Error("Synthetic lost response");
      const result = {url: null, conversationId: null, error: null, effect: effect("possible"), deck};
      if (classification === "missing") delete result.effect;
      if (classification === "wrong-version") result.effect = {schema_version: "1.0.0", remoteEffect: "not_started"};
      if (classification === "extra-field") result.effect = {...effect("not_started"), unsafe: true};
      if (classification === "invalid-url") Object.assign(result, {url: "https://evil.invalid/synthetic", conversationId: "unknown", effect: effect()});
      if (classification === "possible-valid-url" || classification === "missing-valid-url") {
        result.url = "https://tavus.daily.co/synthetic"; result.conversationId = "unknown";
        if (classification === "missing-valid-url") delete result.effect;
      }
      return result;
    }});
    await h.start(); assert.ok(h.button(/^Tentar encerrar/)); assert.equal(h.calls.length, 0); assert.equal(h.stored.values.size, 1); assert.deepEqual([...h.stored.values.values()], [h.starts[0][1]]); h.unmount();
  });
  test(`${mode}: explicit closed not_started clears command, with no Daily or provider stop`, async () => {
    const h = harness(mode, {start: async () => ({url: null, conversationId: null, deck: null, error: "Denied", effect: effect("not_started")})}); await h.start();
    assert.equal(h.stored.values.size, 0); assert.ok(h.button(/^Iniciar/)); assert.equal(h.calls.length, 0); assert.equal(h.stops.length, 0); h.unmount();
  });
  test(`${mode}: same agent in another tenant has an independent recovery key`, async () => {
    const shared = storage(new Map([[recoveryKey(tenantId, mode), "00000000-0000-4000-8000-000000000999"]]));
    const otherTenant = "019f0000-0000-7000-8000-000000000099";
    const h = harness(mode, {storage: shared, props: {tenantId: otherTenant}}); assert.ok(h.button(/^Iniciar/)); await h.start();
    assert.equal(shared.getItem(recoveryKey(tenantId, mode)), "00000000-0000-4000-8000-000000000999"); assert.ok(shared.getItem(recoveryKey(otherTenant, mode))); h.unmount();
  });
  for (const failure of ["access", "write"]) test(`${mode}: ${failure} storage failure blocks dispatch visibly`, async () => {
    const stored = storage(); if (failure === "write") stored.setItem = () => {throw new Error("Synthetic quota failure");};
    const h = harness(mode, {storage: stored, storageAccessError: failure === "access"}); h.consent();
    if (failure === "write") h.click(/^Iniciar/);
    assert.equal(h.starts.length, 0); assert.match(h.text(), /preservar a intenção/); assert.equal(h.button(/^Iniciar/).props.disabled, true); h.unmount();
  });
}

test("presentation: simulated deck remains manual without Daily or stop dispatch", async () => {
  const h = harness("presentation", {start: async () => ({url: null, conversationId: "simulated", deck, error: null, simulated: true, effect: effect("not_started")})});
  await h.start(); assert.equal(h.calls.length, 0); assert.equal(h.imports, 0); assert.equal(h.stored.values.size, 0); assert.match(h.text(), /Modo demonstração/);
  h.click(/^Próximo/); h.click(/^Encerrar$/); await h.settle(); assert.equal(h.stops.length, 0); assert.ok(h.button(/^Nova/)); h.unmount();
});
for (const mode of ["video", "presentation"]) {
  // daily-js 0.91: destroy() awaits leave() and only then frees the global registry, so a
  // second createCallObject() throws while the previous teardown is pending. That throw
  // used to land after the paid start; the next start now waits before any paid effect.
  test(`${mode}: a new call after a normal stop waits for the Daily registry and starts`, async () => {
    const h = harness(mode, {strictRegistry: true}); await h.start();
    h.click(/^Encerrar$/); await h.settle();
    assert.equal(h.calls[0].destroys, 1);
    h.click(/^Nova/); await h.settle();
    await h.start();
    assert.equal(h.starts.length, 2); assert.equal(h.calls.length, 2);
    assert.ok(h.button(/^Encerrar$/)); h.unmount();
  });
  test(`${mode}: a hung leave refuses the next start before any paid effect and allows it once released`, async () => {
    const leave = deferred(), h = harness(mode, {strictRegistry: true, leave}); await h.start();
    h.click(/^Encerrar$/); await h.settle();
    h.click(/^Nova/); await h.settle();
    h.consent(); h.click(/^Iniciar/); await flush(); h.render();
    assert.equal(h.starts.length, 1, "the paid action must not run while the previous teardown is pending");
    h.fireTimers(); await h.settle();
    assert.equal(h.starts.length, 1); assert.equal(h.calls.length, 1);
    assert.match(h.text(), /ainda está sendo encerrada/);
    assert.equal(h.stored.values.size, 0, "nothing was dispatched, so the intent is forgotten");
    assert.ok(h.button(/^Iniciar/)); assert.equal(h.button(/^Tentar encerrar/), undefined);
    leave.resolve(); await flush();
    await h.start();
    assert.equal(h.starts.length, 2); assert.equal(h.calls.length, 2); assert.ok(h.button(/^Encerrar$/)); h.unmount();
  });
  test(`${mode}: a join that never settles ends in recovery with a stop option instead of hanging in starting`, async () => {
    const join = deferred(), h = harness(mode, {join});
    await h.start();
    assert.equal(h.starts.length, 1); assert.equal(h.button(/^Tentar encerrar/), undefined);
    h.fireTimers(); await h.settle();
    assert.ok(h.button(/^Tentar encerrar/), "the paid room is committed, so the user must be able to stop it");
    assert.equal(h.calls[0].leaves, 1); assert.equal(h.calls[0].destroys, 1);
    assert.equal(h.stored.values.size, 1, "the intent is preserved for stop or reconciliation");
    join.resolve(); await flush(); assert.equal(h.calls[0].destroys, 1); h.unmount();
  });
  test(`${mode}: unmounting while the previous teardown is pending never reaches the paid action`, async () => {
    const leave = deferred(), h = harness(mode, {strictRegistry: true, leave}); await h.start();
    h.click(/^Encerrar$/); await h.settle(); h.click(/^Nova/); await h.settle();
    h.consent(); h.click(/^Iniciar/); await flush(); h.render();
    h.unmount(); leave.resolve(); await flush();
    assert.equal(h.starts.length, 1); assert.equal(h.calls.length, 1); assert.equal(h.stored.values.size, 0);
  });
}
test("presentation: missing deck with committed effect keeps recovery", async () => {
  const h = harness("presentation", {start: async () => ({url: "https://tavus.daily.co/synthetic", conversationId: "created", deck: null, error: null, effect: effect()})});
  await h.start(); assert.ok(h.button(/^Tentar encerrar/)); assert.equal(h.calls.length, 0); assert.equal(h.stored.values.size, 1); h.unmount();
});
test("server page passes authenticated tenant identity and fails closed when overview has no tenant", () => {
  const source = readFileSync(new URL("page.tsx", directory), "utf8");
  assert.match(source, /if \(!overview\.tenant\?\.id\)/);
  assert.match(source, /const tenantId = overview\.tenant\.id/);
  assert.match(source, /<VideoCall tenantId=\{tenantId\}/);
  assert.match(source, /<PresentationRoom tenantId=\{tenantId\}/);
});
