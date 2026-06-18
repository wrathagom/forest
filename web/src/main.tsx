import { render } from "solid-js/web";
import { lazy } from "solid-js";
import { Router, Route } from "@solidjs/router";
import App from "./App";
import Dashboard from "./pages/Dashboard";
import ProjectDetail from "./pages/ProjectDetail";
import Settings from "./pages/Settings";
import Sessions from "./pages/Sessions";
import Archives from "./pages/Archives";

const MobileLayout = lazy(() => import("./pages/mobile/MobileLayout"));
const MobileSessionList = lazy(() => import("./pages/mobile/SessionList"));
const MobileSessionDetail = lazy(() => import("./pages/mobile/SessionDetail"));
const MobileNewRun = lazy(() => import("./pages/mobile/NewRun"));

const root = document.getElementById("root");
if (!root) throw new Error("missing #root");
render(
  () => (
    <Router root={App}>
      <Route path="/" component={Dashboard} />
      <Route path="/projects/:id" component={ProjectDetail} />
      <Route path="/settings" component={Settings} />
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
