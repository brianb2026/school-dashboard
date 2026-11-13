import type { ReactNode } from "react";

export function Panel(props: { title: string; meta?: ReactNode; className?: string; children: ReactNode }) {
  return (
    <section className={`panel ${props.className ?? ""}`}>
      <header>
        <h2>{props.title}</h2>
        {props.meta && <span className="meta">{props.meta}</span>}
      </header>
      <div className="body">{props.children}</div>
    </section>
  );
}
