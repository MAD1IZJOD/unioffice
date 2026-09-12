import { createBrowserRouter, redirect } from "react-router-dom";

import App from "../App";
import Activity from "../pages/Activity";
import Agent from "../pages/Agent";
import Agents from "../pages/Agents";
import Approvals from "../pages/Approvals";
import Artifacts from "../pages/Artifacts";
import Brain from "../pages/Brain";
import Command from "../pages/Command";
import Governance from "../pages/Governance";
import MissionStart from "../pages/MissionStart";
import Missions from "../pages/Missions";
import Room from "../pages/Room";
import Organization from "../pages/Organization";
import Tools from "../pages/Tools";
import Workspace from "../pages/Workspace";

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
    element: <App />,
    children: [
      { index: true, element: <Command /> },
      { path: "command", element: <Command /> },
      { path: "missions", element: <Missions /> },
      { path: "missions/new", element: <MissionStart /> },
      { path: "missions/:missionId", element: <Room /> },
      { path: "work", loader: () => redirect("/missions") },
      {
        path: "work/:workId",
        loader: ({ params }) => redirect(`/missions/${params.workId ?? ""}`),
      },
      { path: "agents", element: <Agents /> },
      { path: "agents/:agentId", element: <Agent /> },
      { path: "tools", element: <Tools /> },
      { path: "brain", element: <Brain /> },
      { path: "artifacts", element: <Artifacts /> },
      { path: "approvals", element: <Approvals /> },
      { path: "activity", element: <Activity /> },
      { path: "organization", element: <Organization /> },
      { path: "workspaces/:workspaceId", element: <Workspace /> },
      { path: "governance", element: <Governance /> },
    ],
  },
]);
