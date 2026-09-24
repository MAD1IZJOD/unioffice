import { createBrowserRouter, redirect, type RouteObject } from "react-router-dom";

import App from "../App";
import SessionGate from "./SessionGate";
import Command from "../pages/Command";

/**
 * Loads a page's code the first time someone opens it.
 *
 * The Command Center is where everyone lands, so it ships with the shell.
 * Every other surface is its own chunk: someone reviewing an approval does
 * not download the governance composer, the Company Brain and the execution
 * room first.
 */
function page(load: () => Promise<{ default: React.ComponentType }>): Pick<RouteObject, "lazy"> {
  return {
    lazy: async () => ({ Component: (await load()).default }),
  };
}

/**
 * Work became Mission.
 *
 * The two were always the same row; calling it work made it a record you look
 * at, and calling it a mission makes it an operation you watch. The old paths
 * stay as redirects because links to them exist in browser history and in
 * anything anyone pasted somewhere.
 */
export const router = createBrowserRouter([
  {
    path: "/",
    element: (
      <SessionGate>
        <App />
      </SessionGate>
    ),
    children: [
      { index: true, element: <Command /> },
      { path: "command", element: <Command /> },
      { path: "missions", ...page(() => import("../pages/Missions")) },
      { path: "missions/new", ...page(() => import("../pages/MissionStart")) },
      { path: "missions/new/:templateId", ...page(() => import("../pages/TemplateMission")) },
      { path: "missions/:missionId/brief", ...page(() => import("../pages/MissionBrief")) },
      { path: "missions/:missionId", ...page(() => import("../pages/Room")) },
      { path: "schedules", ...page(() => import("../pages/Schedules")) },
      { path: "schedules/:scheduleId", ...page(() => import("../pages/Schedule")) },
      { path: "work", loader: () => redirect("/missions") },
      {
        path: "work/:workId",
        loader: ({ params }) => redirect(`/missions/${params.workId ?? ""}`),
      },
      { path: "readiness", ...page(() => import("../pages/Readiness")) },
      { path: "workforce", ...page(() => import("../pages/Workforce")) },
      { path: "workforce/:agentId", ...page(() => import("../pages/Agent")) },
      // Agents became the workforce. Links to the old paths keep working.
      { path: "agents", loader: () => redirect("/workforce") },
      {
        path: "agents/:agentId",
        loader: ({ params }) => redirect(`/workforce/${params.agentId ?? ""}`),
      },
      { path: "skills", ...page(() => import("../pages/Skills")) },
      {
        path: "skills/new",
        lazy: async () => ({ Component: (await import("../pages/Skill")).NewSkill }),
      },
      { path: "skills/:skillRef", ...page(() => import("../pages/Skill")) },
      { path: "tools", ...page(() => import("../pages/Tools")) },
      { path: "brain", ...page(() => import("../pages/Brain")) },
      { path: "brain/:knowledgeId", ...page(() => import("../pages/KnowledgeEntry")) },
      { path: "artifacts", ...page(() => import("../pages/Artifacts")) },
      { path: "approvals", ...page(() => import("../pages/Approvals")) },
      { path: "activity", ...page(() => import("../pages/Activity")) },
      { path: "organization", ...page(() => import("../pages/Organization")) },
      { path: "members", ...page(() => import("../pages/Members")) },
      { path: "workspaces/:workspaceId", ...page(() => import("../pages/Workspace")) },
      { path: "governance", ...page(() => import("../pages/Governance")) },
      { path: "settings", loader: () => redirect("/settings/connections") },
      { path: "settings/connections", ...page(() => import("../pages/Connections")) },
      { path: "settings/connections/:connectionId", ...page(() => import("../pages/Connection")) },
    ],
  },
]);
