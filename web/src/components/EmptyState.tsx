export default function EmptyState(props: {
  onConfigure: () => void;
  onNewProject?: () => void;
}) {
  return (
    <div class="empty">
      <h2>No projects yet</h2>
      <p>Set a scan root to discover git repos under it, or create a new one.</p>
      <div class="empty-actions">
        <button onclick={props.onConfigure}>open settings</button>
        {props.onNewProject && (
          <button class="empty-secondary" onclick={() => props.onNewProject!()}>+ new project</button>
        )}
      </div>
    </div>
  );
}
