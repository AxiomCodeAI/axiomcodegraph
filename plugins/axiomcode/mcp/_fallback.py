"""A dependency-free stand-in for the sliver of the MCP SDK this server uses (#1105).

The server needs exactly three things from the SDK: `MCPServer(name)`, a `@tool()` decorator, and
`run()` over stdio. Nothing installs the SDK -- the plugin is installed by copying files, npm cannot
express a Python requirement, and a plugin install has no step that could satisfy one -- so on a host
whose interpreters happen not to carry it the server exited at import and the client reported only a
failed connection. Probing for an interpreter that has it, or fetching it with uv, both assume
something about the host; this assumes nothing.

MCP over stdio is newline-delimited JSON-RPC 2.0. The methods a client needs before it can call a tool
are `initialize`, the `notifications/initialized` acknowledgement, `tools/list` and `tools/call`, plus
`ping`; that is the whole protocol surface implemented here, and unknown methods get a proper
"method not found" rather than silence.

This is a FALLBACK. server.py prefers the real SDK whenever it imports, because the SDK tracks the
spec and this does not. What this guarantees is that a missing package degrades to a working server
instead of no server at all.
"""
import inspect, json, sys, typing

__all__ = ["MCPServer"]

_JSON_TYPE = {str: "string", int: "integer", float: "number", bool: "boolean", list: "array", dict: "object"}


def _schema_for(ann, default):
    """One parameter's JSON schema, from its annotation, falling back to the default's type."""
    if ann is inspect.Parameter.empty:
        ann = type(default) if default is not inspect.Parameter.empty and default is not None else str
    origin = typing.get_origin(ann)
    if origin in (list, typing.List):
        args = typing.get_args(ann)
        return {"type": "array", "items": {"type": _JSON_TYPE.get(args[0], "string") if args else "string"}}
    if origin is not None:                      # Optional[X] / Union[...] -> first concrete arg
        args = [a for a in typing.get_args(ann) if a is not type(None)]
        return _schema_for(args[0], default) if args else {"type": "string"}
    return {"type": _JSON_TYPE.get(ann, "string")}


def _nullable(ann, default):
    """Whether None is a value the parameter takes: Optional[X], or a default of None."""
    return default is None or (typing.get_origin(ann) is typing.Union and type(None) in typing.get_args(ann))


_CHECK = {"string": lambda v: isinstance(v, str),
          "integer": lambda v: isinstance(v, int) and not isinstance(v, bool),
          "number": lambda v: isinstance(v, (int, float)) and not isinstance(v, bool),
          "boolean": lambda v: isinstance(v, bool),
          "array": lambda v: isinstance(v, list),
          "object": lambda v: isinstance(v, dict)}


def _conforms(value, schema):
    if not _CHECK.get(schema["type"], lambda v: True)(value):
        return False
    return schema["type"] != "array" or all(_conforms(x, schema["items"]) for x in value)


def _invalid(spec, nullable, arguments):
    """Why these arguments do not fit the advertised schema, or None if they do (#1243).

    The SDK validates a call against the schema before the function runs; without that, a string sent for
    a list[str] reached `[*targets]` and was splatted into characters, so impact answered about `u` with no
    error. A call that does not fit is refused with the field named, as the SDK refuses it."""
    schema = spec["inputSchema"]
    errors = [f"{k}: missing required argument" for k in schema["required"] if k not in arguments]
    for k, v in arguments.items():
        want = schema["properties"].get(k)
        if want is None:
            errors.append(f"{k}: unexpected argument")
        elif not (v is None and k in nullable) and not _conforms(v, want):
            shown = want["type"] + (f" of {want['items']['type']}" if want["type"] == "array" else "")
            errors.append(f"{k}: expected {shown}, got {type(v).__name__} {json.dumps(v)[:60]}")
    return f"invalid arguments for {spec['name']}: " + "; ".join(errors) if errors else None


class MCPServer:
    def __init__(self, name, version=""):
        self.name, self.version, self._tools = name, version, {}

    def tool(self, name=None, description=None, **_ignored):
        """Collect the function and derive its input schema from the signature, as the SDK does."""
        def deco(fn):
            sig = inspect.signature(fn)
            props, required, nullable = {}, [], set()
            for pname, p in sig.parameters.items():
                props[pname] = _schema_for(p.annotation, p.default)
                if _nullable(p.annotation, p.default):
                    nullable.add(pname)
                if p.default is inspect.Parameter.empty:
                    required.append(pname)
            self._tools[name or fn.__name__] = {
                "fn": fn,
                "nullable": nullable,
                "spec": {"name": name or fn.__name__,
                         "description": (description or fn.__doc__ or "").strip(),
                         "inputSchema": {"type": "object", "properties": props, "required": required}},
            }
            return fn
        return deco

    # ── the protocol ────────────────────────────────────────────────────────────────────────────────
    def _handle(self, msg):
        m, mid = msg.get("method"), msg.get("id")
        if m == "initialize":
            return {"protocolVersion": msg.get("params", {}).get("protocolVersion", "2024-11-05"),
                    "capabilities": {"tools": {"listChanged": False}},
                    "serverInfo": {"name": self.name, "version": self.version}}
        if m == "tools/list":
            return {"tools": [t["spec"] for t in self._tools.values()]}
        if m == "tools/call":
            p = msg.get("params") or {}
            t = self._tools.get(p.get("name"))
            if not t:
                raise LookupError(f"unknown tool {p.get('name')!r}")
            # a tool that raises must come back as an MCP tool error, not a transport error: the client
            # can show the agent the former and can only drop the connection on the latter
            args = p.get("arguments") or {}
            bad = _invalid(t["spec"], t["nullable"], args) if isinstance(args, dict) else "arguments: expected object"
            if bad:
                return {"content": [{"type": "text", "text": bad}], "isError": True}
            try:
                out = t["fn"](**args)
                return {"content": [{"type": "text", "text": "" if out is None else str(out)}]}
            except Exception as e:
                return {"content": [{"type": "text", "text": f"{type(e).__name__}: {e}"}], "isError": True}
        if m == "ping":
            return {}
        if mid is None:                          # a notification we do not implement: acknowledge by silence
            return None
        raise NotImplementedError(m)

    def run(self, transport="stdio", **_ignored):
        if transport != "stdio":
            raise ValueError(f"the fallback MCP server speaks stdio only, not {transport!r}")
        for line in sys.stdin:
            line = line.strip()
            if not line:
                continue
            try:
                msg = json.loads(line)
            except Exception:
                continue                         # a frame we cannot parse has no id to answer against
            mid = msg.get("id")
            try:
                result = self._handle(msg)
            except NotImplementedError as e:
                reply = {"jsonrpc": "2.0", "id": mid, "error": {"code": -32601, "message": f"method not found: {e}"}}
            except Exception as e:
                reply = {"jsonrpc": "2.0", "id": mid, "error": {"code": -32603, "message": f"{type(e).__name__}: {e}"}}
            else:
                if mid is None:                  # notification: nothing is sent back, by spec
                    continue
                reply = {"jsonrpc": "2.0", "id": mid, "result": result}
            sys.stdout.write(json.dumps(reply) + "\n")
            sys.stdout.flush()
