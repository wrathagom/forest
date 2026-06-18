// Route definitions — see main.tsx where these are registered with <Router root={App}>.
// @solidjs/router v0.16+ embeds <Route> children directly in <Router>; there is no
// separate <Routes> wrapper component in this version.
export { default as Dashboard } from "./pages/Dashboard";
export { default as ProjectDetail } from "./pages/ProjectDetail";
export { default as Settings } from "./pages/Settings";
