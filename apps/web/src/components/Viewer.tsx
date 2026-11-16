import { useEffect, useState } from "react";
import { api, enc } from "../lib/api";

export interface ViewFile {
  id: string;
  name: string;
  /** Open a PDF at this page (from a search hit). */
  page?: number;
}

const ext = (name: string) => name.toLowerCase().split(".").pop() ?? "";
const SHOWN = new Set(["pdf", "png", "jpg", "jpeg", "gif"]);
const TEXT = new Set(["docx", "txt", "md"]);

export function canPreview(name: string): boolean {
  return SHOWN.has(ext(name)) || TEXT.has(ext(name));
}

/** Read a course file without leaving the dashboard: PDFs and images in place, Word and text files as plain text. */
export function Viewer({ file, onClose }: { file: ViewFile; onClose: () => void }) {
  const kind = ext(file.name);
  const [text, setText] = useState<string>();
  const [error, setError] = useState<string>();
  const download = `/api/files/${enc(file.id)}/download`;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    if (!TEXT.has(kind)) return;
    let live = true;
    api<{ text: string }>(`/api/files/${enc(file.id)}/text`)
      .then((r) => live && setText(r.text))
      .catch((e: Error) => live && setError(e.message));
    return () => {
      live = false;
    };
  }, [file.id, kind]);

  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal viewer" role="dialog" aria-modal="true" aria-label={file.name}>
        <header>
          <h2>{file.name}</h2>
          <span className="inline-form">
            <a className="btn" href={download} download={file.name}>Download</a>
            <button type="button" className="btn ghost" onClick={onClose} aria-label="Close">✕</button>
          </span>
        </header>
        <div className="viewer-body">
          {kind === "pdf" && <iframe title={file.name} src={`/api/files/${enc(file.id)}/view${file.page && file.page > 1 ? `#page=${file.page}` : ""}`} />}
          {(kind === "png" || kind === "jpg" || kind === "jpeg" || kind === "gif") && <img alt={file.name} src={`/api/files/${enc(file.id)}/view`} />}
          {TEXT.has(kind) && (error ? <p className="form-msg error pad">{error}</p> : text === undefined ? <p className="muted pad">Opening…</p> : <pre className="doc-text">{text}</pre>)}
          {!canPreview(file.name) && (
            <p className="pad muted">
              This kind of file ({kind || "unknown"}) can't be shown here. <a href={download} download={file.name}>Download it</a> to open it on your Mac.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

/** Small "open this" buttons for the files that go with an assignment. */
export function Materials({ items, onOpen, max = 2 }: { items?: ViewFile[]; onOpen: (f: ViewFile) => void; max?: number }) {
  if (!items?.length) return null;
  return (
    <span className="mats">
      {items.slice(0, max).map((m) => (
        <button key={m.id} type="button" className="mat" title={`Open ${m.name}`} onClick={() => onOpen(m)}>
          Open <span className="mat-name">{m.name.replace(/\.[a-z0-9]{2,5}$/i, "")}</span>
        </button>
      ))}
    </span>
  );
}
