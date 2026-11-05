import { useRef, useState } from "react";

export default function TaskForm({ onCreate }) {
  const [title, setTitle] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const input = useRef(null);

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      await onCreate(title); // the server owns validation, so its message is the one shown
      setTitle((current) => (current === title ? "" : current)); // keep anything typed while saving
      setError("");
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
      if (document.activeElement?.tagName !== "INPUT") input.current?.focus(); // ready for the next task
    }
  };

  return (
    <form className="add" onSubmit={submit} noValidate>
      <label className="add-field" htmlFor="new-task">
        New task
      </label>
      <div className="add-row">
        <input
          id="new-task"
          ref={input}
          autoComplete="off"
          aria-invalid={Boolean(error)}
          aria-describedby="add-error"
          placeholder="What needs doing?"
          value={title}
          maxLength={200}
          onChange={(e) => {
            setTitle(e.target.value);
            setError("");
          }}
        />
        <button className="cta" type="submit" disabled={saving}>
          Add task
        </button>
      </div>
      <p id="add-error" className="add-error" role="alert">
        {error}
      </p>
    </form>
  );
}
