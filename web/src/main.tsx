import { render } from "solid-js/web";
import { lazy } from "solid-js";
import { Router, Route, Navigate } from "@solidjs/router";
import App from "./App";
import Dashboard from "./pages/Dashboard";
import ProjectDetail from "./pages/ProjectDetail";
import Settings from "./pages/Settings";
import Sessions from "./pages/Sessions";
import Archives from "./pages/Archives";
import AppearanceSection from "./components/settings/AppearanceSection";
import DashboardSection from "./components/settings/DashboardSection";
import ScanSection from "./components/settings/ScanSection";
import TerminalsSection from "./components/settings/TerminalsSection";
import LaunchersSection from "./components/settings/LaunchersSection";
import IntegrationsSection from "./components/settings/IntegrationsSection";
import SystemSection from "./components/settings/SystemSection";
import { initTheme } from "./lib/themes/current";

const MobileLayout = lazy(() => import("./pages/mobile/MobileLayout"));
const MobileSessionList = lazy(() => import("./pages/mobile/SessionList"));
const MobileSessionDetail = lazy(() => import("./pages/mobile/SessionDetail"));
const MobileNewRun = lazy(() => import("./pages/mobile/NewRun"));

const root = document.getElementById("root");
if (!root) throw new Error("missing #root");
initTheme();
render(
  () => (
    <Router root={App}>
      <Route path="/" component={Dashboard} />
      <Route path="/projects/:id" component={ProjectDetail} />
      <Route path="/settings" component={Settings}>
        <Route path="/" component={() => <Navigate href="/settings/appearance" />} />
        <Route path="/appearance" component={AppearanceSection} />
        <Route path="/dashboard" component={DashboardSection} />
        <Route path="/scan" component={ScanSection} />
        <Route path="/terminals" component={TerminalsSection} />
        <Route path="/launchers" component={LaunchersSection} />
        <Route path="/integrations" component={IntegrationsSection} />
        <Route path="/system" component={SystemSection} />
      </Route>
      <Route path="/sessions" component={Sessions} />
      <Route path="/archives" component={Archives} />
      <Route path="/m" component={MobileLayout}>
        <Route path="/" component={MobileSessionList} />
        <Route path="/new" component={MobileNewRun} />
        <Route path="/s/:sid" component={MobileSessionDetail} />
      </Route>
    </Router>
  ),
  root,
);
