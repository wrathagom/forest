import BbsSettings from "../BbsSettings";

// BbsSettings owns its own fetch and save buttons, so nothing is held outside
// it and there is no unsaved-changes guard to install.
export default function IntegrationsSection() {
  return (
    <section>
      <h3>integrations</h3>
      <BbsSettings />
    </section>
  );
}
