# UniGateway (Rust)

Embedded LLM router binary used by the control plane. Server-side lifecycle in `server/src/gateway/unigatewayManager.js`.

## Build

```bash
cd gateway && cargo build --release
```

Release artifact: `gateway/target/release/xensemble-unigateway` (name may match `Cargo.toml` bin).

Control plane expects the binary on `PATH` or under `gateway/target/release/` when starting UniGateway (see `unigatewayManager.js`).

## Config

- TOML: `server/data/unigateway.toml` (local; not always in git)
- Secrets: provider API keys via platform settings / env synthesis (`server/src/gateway/readProviderSecrets.js`)

Default listen: `127.0.0.1:8741` (internal only). Public agent traffic uses control plane LLM proxy (`docs/LlmProxy.md`).

## Server integration

| Path | Role |
|---|---|
| `server/src/gateway/unigatewayManager.js` | Start/stop process, health, base URL |
| `server/src/gateway/defaultConfig.js` | Default TOML template |
| `server/src/gateway/testProviderConnectivity.js` | Admin connectivity checks |
| `server/src/llm/proxy.js` | HTTP proxy to UniGateway for agent sessions |

## Tests

Rust: `cargo test` in `gateway/`.

Node (manager/helpers): `cd server && npm test -- src/gateway/*.test.js` if present.

## Docs

- [docs/agents.md](../docs/agents.md) — UniGateway section
- [docs/LlmProxy.md](../docs/LlmProxy.md) — agent-facing proxy
