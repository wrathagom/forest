import ProcessesPanel from "./ProcessesPanel";
import ContainersPanel from "./ContainersPanel";

export default function MonitorPanel(props: { projectId: string; enabled: () => boolean }) {
  return (
    <div class="monitor-panel">
      <h3 class="monitor-section-head">Processes</h3>
      <ProcessesPanel projectId={props.projectId} enabled={props.enabled} />
      <h3 class="monitor-section-head">Containers</h3>
      <ContainersPanel projectId={props.projectId} enabled={props.enabled} />
    </div>
  );
}
