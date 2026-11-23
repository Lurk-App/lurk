// The grouped form's pieces of the settings window: a section with its title, a switch row.

import { useId, type ReactNode } from 'react';

/** A switch in a settings form: the label on the left, the switch on the right, a note below. */
export function ToggleRow({
  label,
  note,
  checked,
  disabled = false,
  onChange,
}: {
  label: string;
  note?: string;
  checked: boolean;
  /** Not changeable while another setting rules it out (the label dims with it). */
  disabled?: boolean;
  onChange(value: boolean): void;
}) {
  const id = useId();
  const noteId = useId();
  return (
    <div className={`form-row column${disabled ? ' is-disabled' : ''}`}>
      <div className="form-line">
        <label htmlFor={id}>{label}</label>
        <input
          id={id}
          type="checkbox"
          role="switch"
          className="switch"
          checked={checked}
          disabled={disabled}
          aria-describedby={note ? noteId : undefined}
          onChange={(event) => onChange(event.target.checked)}
        />
      </div>
      {note ? (
        <p className="form-note" id={noteId}>
          {note}
        </p>
      ) : null}
    </div>
  );
}

export function FormSection({ title, children }: { title: string; children: ReactNode }) {
  const id = useId();
  return (
    <section className="form-section" aria-labelledby={id}>
      <h2 className="form-section-title" id={id}>
        {title}
      </h2>
      <div className="form-group">{children}</div>
    </section>
  );
}
