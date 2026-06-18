import { type RouteSectionProps, useLocation, useNavigate } from "@solidjs/router";
import { Show } from "solid-js";
import "./mobile.css";

export default function MobileLayout(props: RouteSectionProps) {
  const loc = useLocation();
  const navigate = useNavigate();
  const atRoot = () => loc.pathname === "/m" || loc.pathname === "/m/";
  return (
    <div class="m-root">
      <div class="m-bar">
        <Show when={!atRoot()} fallback={<span class="m-brand"><span class="m-brand-mark">ƒ</span>orest</span>}>
          <button type="button" class="m-back" onClick={() => navigate("/m")}>‹ sessions</button>
        </Show>
      </div>
      <div class="m-main">{props.children}</div>
    </div>
  );
}
