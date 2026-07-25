import { autoRefresh, setAutoRefresh } from "../../lib/preferences";

export default function DashboardSection() {
  return (
    <section>
      <h3>dashboard</h3>
      <span class="hint">applies immediately and is remembered on this device only</span>
      <div class="settings-fields">
        <label class="checkbox-row">
          <input
            type="checkbox"
            checked={autoRefresh()}
            onchange={(e) => setAutoRefresh(e.currentTarget.checked)}
          />
          auto-refresh dashboard every 5s
        </label>
      </div>
    </section>
  );
}
