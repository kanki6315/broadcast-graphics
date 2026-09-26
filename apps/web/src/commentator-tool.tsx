import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ExternalLink, ChevronDown, ChevronUp, PanelBottom } from "lucide-react";

/** A portal keeps pop-outs on the same live state and class selection as the desk. */
export function CommentatorTool({ id, title, context, children }: { id: string; title: string; context: string; children: ReactNode }) {
  const key = `gantry.tool.${id}`;
  const [collapsed, setCollapsed] = useState(() => { try { return localStorage.getItem(key) === "collapsed"; } catch { return false; } });
  const [detached, setDetached] = useState(() => { try { return localStorage.getItem(key) === "detached"; } catch { return false; } });
  const [target, setTarget] = useState<HTMLElement | null>(null);
  const [error, setError] = useState("");
  const popup = useRef<Window | null>(null);
  useEffect(() => { try { localStorage.setItem(key, detached ? "detached" : collapsed ? "collapsed" : "docked"); } catch { /* Storage may be disabled. */ } }, [collapsed, detached, key]);
  useEffect(() => () => { popup.current?.close(); }, []);
  useEffect(() => {
    if (!target) return;
    const timer = window.setInterval(() => {
      if (popup.current?.closed) { popup.current = null; setTarget(null); setDetached(false); }
    }, 500);
    const close = () => popup.current?.close();
    window.addEventListener("beforeunload", close);
    return () => { clearInterval(timer); window.removeEventListener("beforeunload", close); };
  }, [target]);
  function detach() {
    if (popup.current && !popup.current.closed) { popup.current.focus(); return; }
    const next = window.open("/commentator-window.html", `gantry-${id}`, "popup,width=850,height=550");
    if (!next) { setError("Pop-out blocked. Allow pop-ups for this site and try again."); return; }
    popup.current = next; setDetached(true); setError("");
    const prepare = () => {
      if (next.closed) return;
      next.document.head.replaceChildren();
      next.document.title = `${title} · Gantry`;
      const base = next.document.createElement("base");
      base.href = document.baseURI;
      next.document.head.append(base);
      for (const sheet of document.styleSheets) {
        try {
          const style = next.document.createElement("style");
          style.textContent = [...sheet.cssRules].map((rule) => rule.cssText).join("\n");
          next.document.head.append(style);
        } catch {
          // Cross-origin sheets cannot expose rules; let the browser load their URL.
          if (sheet.href) {
            const link = next.document.createElement("link");
            link.rel = "stylesheet"; link.href = sheet.href;
            next.document.head.append(link);
          }
        }
      }
      next.document.body.replaceChildren();
      next.document.body.className = "commentator-popout";
      const root = next.document.createElement("div");
      next.document.body.append(root);
      setTarget(root); setCollapsed(false);
    };
    if (next.document.readyState === "complete" && next.location.pathname === "/commentator-window.html") prepare();
    else next.addEventListener("load", prepare, { once: true });
  }
  function dock() { setError(""); setDetached(false); setTarget(null); popup.current?.close(); popup.current = null; }
  const content = <section className={`commentator-tool${collapsed && !target ? " is-collapsed" : ""}`}>
    <header className="tool-heading"><div><strong>{title}</strong><span>{context}</span></div><div className="tool-actions">
      {target ? <button onClick={dock} title="Dock in timing workspace"><PanelBottom />Dock</button> : <>
        <button onClick={detach} title={`Pop out ${title}`}><ExternalLink /><span>Pop out</span></button>
        <button onClick={() => setCollapsed(!collapsed)} aria-label={`${collapsed ? "Expand" : "Collapse"} ${title}`}>{collapsed ? <ChevronDown /> : <ChevronUp />}</button>
      </>}
    </div></header>
    {error && <p role="alert">{error}</p>}
    {(!collapsed || target) && <div className="tool-content">{children}</div>}
  </section>;
  return detached ? <><div className="tool-detached"><strong>{title}</strong><span>{target ? "Open in another window" : "Saved pop-out layout"}</span><button onClick={detach}>{target ? "Show window" : "Reopen window"}</button><button onClick={dock}>Dock</button>{error && <p role="alert">{error}</p>}</div>{target && createPortal(content, target)}</> : content;
}
