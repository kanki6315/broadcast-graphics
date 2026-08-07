import { useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowLeft, Check, Copy, KeyRound, LogIn, LogOut, Plus, Radio, ShieldCheck, Trash2 } from "lucide-react";
import type { AccessKey, AccessKeyKind, CreatedAccessKey } from "@racecontrol/protocol";
import { ControlPanel } from "./control-panel";

interface AdminIdentity {
  username: string;
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: init?.body ? { "Content-Type": "application/json", ...init.headers } : init?.headers,
  });
  const body = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) {
    if (response.status === 401 && path !== "/api/auth/login") window.dispatchEvent(new Event("broadcast-auth-expired"));
    throw new Error(body.error ?? "The server could not complete that request.");
  }
  return body;
}

function LoginScreen({ onLogin }: { onLogin: (identity: AdminIdentity) => void }) {
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError("");
    try {
      onLogin(await api<AdminIdentity>("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ username, password }),
      }));
    } catch (loginError) {
      setError(loginError instanceof Error ? loginError.message : "Login failed.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="auth-shell">
      <section className="login-sheet" aria-labelledby="login-title">
        <div className="auth-registration"><span className="registration-mark" aria-hidden="true" /><span>Authorized operators only</span></div>
        <div className="login-heading"><img className="login-brand-mark" src="/brand/gantry-mark.svg" alt="" /><div><h1 id="login-title">Open Gantry control</h1><p>Sign in to operate graphics and manage broadcast access.</p></div></div>
        <form onSubmit={submit}>
          <label className="auth-field"><span>Username</span><input autoComplete="username" value={username} onChange={(event) => setUsername(event.target.value)} required /></label>
          <label className="auth-field"><span>Password</span><input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required autoFocus /></label>
          {error && <p className="auth-error" role="alert">{error}</p>}
          <button className="auth-primary" disabled={submitting}><LogIn aria-hidden="true" />{submitting ? "Checking credentials…" : "Enter control desk"}</button>
        </form>
        <footer><Radio aria-hidden="true" /><span>Telemetry and overlay access use separate revocable keys.</span></footer>
      </section>
    </main>
  );
}

function SecretReceipt({ created, onDone }: { created: CreatedAccessKey; onDone: () => void }) {
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState("");
  const receiptRef = useRef<HTMLElement>(null);
  const isView = created.key.kind === "view";
  const value = isView
    ? `${window.location.origin}/overlay#token=${created.secret}`
    : created.secret;

  useEffect(() => receiptRef.current?.focus(), []);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopyError("");
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2_000);
    } catch {
      setCopyError("Clipboard access was blocked. Select the value above and copy it manually.");
    }
  }

  return (
    <section className="secret-receipt" aria-live="polite" ref={receiptRef} tabIndex={-1}>
      <div><ShieldCheck aria-hidden="true" /><div><h2>Key created</h2><p>Copy it now. The complete value cannot be shown again.</p></div></div>
      <label><span>{isView ? "Overlay URL" : "Ingestion key"}</span><textarea readOnly value={value} rows={isView ? 3 : 2} /></label>
      <div className="receipt-actions">
        <button className="auth-primary" onClick={copy}>{copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}{copied ? "Copied" : isView ? "Copy overlay URL" : "Copy key"}</button>
        <button className="auth-secondary" onClick={onDone}>Done</button>
      </div>
      {copyError && <p className="receipt-error" role="alert">{copyError}</p>}
      {!isView && <code>$env:BROADCAST_GRAPHICS_INGESTION_KEY=&quot;{created.secret}&quot;</code>}
    </section>
  );
}

function AccessManager({ identity, onLogout }: { identity: AdminIdentity; onLogout: () => Promise<void> }) {
  const [keys, setKeys] = useState<AccessKey[]>([]);
  const [kind, setKind] = useState<AccessKeyKind>("ingestion");
  const [label, setLabel] = useState("");
  const [created, setCreated] = useState<CreatedAccessKey | null>(null);
  const [error, setError] = useState("");
  const [loadError, setLoadError] = useState("");
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [confirmRevoke, setConfirmRevoke] = useState<string | null>(null);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [revokeError, setRevokeError] = useState<{ id: string; message: string } | null>(null);
  const [statusMessage, setStatusMessage] = useState("");
  const [loggingOut, setLoggingOut] = useState(false);

  async function loadKeys() {
    try {
      setKeys(await api<AccessKey[]>("/api/auth/keys"));
      setLoadError("");
    } catch (loadError) {
      setLoadError(loadError instanceof Error ? loadError.message : "Access keys could not be loaded.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void loadKeys(); }, []);
  useEffect(() => {
    if (!confirmRevoke) return;
    const timer = window.setTimeout(() => setConfirmRevoke(null), 4_000);
    return () => window.clearTimeout(timer);
  }, [confirmRevoke]);

  async function createKey(event: FormEvent) {
    event.preventDefault();
    setCreating(true);
    setError("");
    try {
      const result = await api<CreatedAccessKey>("/api/auth/keys", {
        method: "POST",
        body: JSON.stringify({ kind, label }),
      });
      setCreated(result);
      setStatusMessage(`${result.key.label} key created.`);
      setLabel("");
      await loadKeys();
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "The key could not be created.");
    } finally {
      setCreating(false);
    }
  }

  async function revoke(id: string) {
    if (confirmRevoke !== id) {
      setConfirmRevoke(id);
      return;
    }
    setRevokingId(id);
    setRevokeError(null);
    try {
      await api(`/api/auth/keys/${id}`, { method: "DELETE" });
      setConfirmRevoke(null);
      setStatusMessage("Key revoked.");
      await loadKeys();
    } catch (revokeError) {
      setRevokeError({ id, message: revokeError instanceof Error ? revokeError.message : "The key could not be revoked." });
    } finally {
      setRevokingId(null);
    }
  }

  async function logout() {
    setLoggingOut(true);
    setError("");
    try {
      await onLogout();
    } catch (logoutError) {
      setError(logoutError instanceof Error ? logoutError.message : "Sign out failed. This session remains active.");
      setLoggingOut(false);
    }
  }

  return (
    <div className="access-shell">
      <header className="access-masthead">
        <a href="/control"><ArrowLeft aria-hidden="true" />Control desk</a>
        <div className="access-identity"><img src="/brand/gantry-mark.svg" alt="" /><div><strong>Gantry access</strong><span>Signed in as {identity.username}</span></div></div>
        <button onClick={() => void logout()} disabled={loggingOut}><LogOut aria-hidden="true" />{loggingOut ? "Signing out…" : "Sign out"}</button>
      </header>
      <main className="access-grid">
        <section className="key-issue" aria-labelledby="issue-title">
          <div className="access-heading"><KeyRound aria-hidden="true" /><div><h1 id="issue-title">Issue a new key</h1><p>Give each telemetry PC and browser-source group its own key so access can be revoked independently.</p></div></div>
          {created ? <SecretReceipt created={created} onDone={() => setCreated(null)} /> : (
            <form onSubmit={createKey}>
              <fieldset><legend>Access type</legend>
                <label className={kind === "ingestion" ? "is-selected" : ""}><input type="radio" name="kind" value="ingestion" checked={kind === "ingestion"} onChange={() => setKind("ingestion")} /><span><strong>Telemetry ingestion</strong><small>Sends race data from one iRacing PC.</small></span></label>
                <label className={kind === "view" ? "is-selected" : ""}><input type="radio" name="kind" value="view" checked={kind === "view"} onChange={() => setKind("view")} /><span><strong>Overlay viewer</strong><small>Reads graphics state in vMix or OBS.</small></span></label>
              </fieldset>
              <label className="auth-field"><span>Key label</span><input value={label} maxLength={80} onChange={(event) => setLabel(event.target.value)} placeholder={kind === "ingestion" ? "Racing PC" : "vMix production PC"} required /></label>
              <button className="auth-primary" disabled={creating}><Plus aria-hidden="true" />{creating ? "Creating key…" : `Create ${kind === "ingestion" ? "ingestion" : "view"} key`}</button>
            </form>
          )}
          {error && <p className="auth-error" role="alert">{error}</p>}
        </section>

        <section className="key-register" aria-labelledby="register-title">
          <p className="live-status" role="status">{statusMessage}</p>
          <div className="register-heading"><div><h2 id="register-title">Key register</h2><p>Secrets are stored as one-way hashes. Revoking a key disconnects it the next time it reconnects.</p></div><span>{loading ? "Checking" : loadError ? "Unknown" : `${keys.filter((key) => !key.revokedAt).length} active`}</span></div>
          {loading ? <p className="register-empty">Reading key register…</p> : loadError ? <div className="register-load-error" role="alert"><p>{loadError}</p><button className="auth-secondary" onClick={() => { setLoading(true); void loadKeys(); }}>Retry key register</button></div> : keys.length === 0 ? <p className="register-empty">No keys issued yet. Create one for the iRacing telemetry client first.</p> : (
            <div className="key-table-wrap"><table className="key-table"><thead><tr><th>Label</th><th>Scope</th><th>Identifier</th><th>Issued</th><th>Status</th><th>Actions</th></tr></thead><tbody>
              {keys.map((key) => [<tr key={key.id} className={key.revokedAt ? "is-revoked" : ""}>
                <td data-label="Label"><strong>{key.label}</strong></td><td data-label="Scope">{key.kind === "ingestion" ? "Telemetry" : "View only"}</td><td data-label="Identifier"><code>{key.prefix}…</code></td><td data-label="Issued">{new Date(key.createdAt).toLocaleDateString()}</td><td data-label="Status"><span className="key-status">{key.revokedAt ? "Revoked" : "Active"}</span></td>
                <td data-label="Actions"><button disabled={Boolean(key.revokedAt) || revokingId === key.id} className={confirmRevoke === key.id ? "is-confirming" : ""} onClick={() => void revoke(key.id)}><Trash2 aria-hidden="true" />{revokingId === key.id ? "Revoking…" : confirmRevoke === key.id ? "Confirm revoke" : "Revoke"}</button></td>
              </tr>, revokeError?.id === key.id && <tr className="key-row-error" key={`${key.id}-error`}><td colSpan={6} role="alert">{revokeError.message}</td></tr>])}
            </tbody></table></div>
          )}
        </section>
      </main>
    </div>
  );
}

export function AdminApp() {
  const [identity, setIdentity] = useState<AdminIdentity | null>(null);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    const check = () => api<AdminIdentity>("/api/auth/me").then(setIdentity).catch(() => setIdentity(null));
    void check().finally(() => setChecking(false));
    const timer = window.setInterval(() => void check(), 5 * 60_000);
    const expired = () => setIdentity(null);
    window.addEventListener("broadcast-auth-expired", expired);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("broadcast-auth-expired", expired);
    };
  }, []);

  async function logout() {
    await api("/api/auth/logout", { method: "POST" });
    setIdentity(null);
    window.history.replaceState(null, "", "/control");
  }

  if (checking) return <main className="loading-screen"><Radio aria-hidden="true" /><h1>Checking operator access</h1><p>Confirming this browser session with the server.</p></main>;
  if (!identity) return <LoginScreen onLogin={setIdentity} />;
  if (window.location.pathname === "/access") return <AccessManager identity={identity} onLogout={logout} />;
  return <ControlPanel onManageAccess={() => { window.location.href = "/access"; }} onLogout={logout} />;
}
