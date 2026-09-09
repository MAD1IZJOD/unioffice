import { createBrowserRouter, redirect } from "react-router-dom";

import App from "../App";
import Activity from "../pages/Activity";
import Agents from "../pages/Agents";
import Approvals from "../pages/Approvals";
import Artifacts from "../pages/Artifacts";
import Brain from "../pages/Brain";
import Command from "../pages/Command";
import Mission from "../pages/Mission";
import MissionStart from "../pages/MissionStart";
import Missions from "../pages/Missions";
import NotBuilt from "../pages/NotBuilt";
import Tools from "../pages/Tools";

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
      { path: "missions/:missionId", element: <Mission /> },
      { path: "work", loader: () => redirect("/missions") },
      {
        path: "work/:workId",
        loader: ({ params }) => redirect(`/missions/${params.workId ?? ""}`),
      },
      { path: "agents", element: <Agents /> },
      { path: "tools", element: <Tools /> },
      { path: "brain", element: <Brain /> },
      { path: "artifacts", element: <Artifacts /> },
      { path: "approvals", element: <Approvals /> },
      { path: "activity", element: <Activity /> },
      {
        path: "organization",
        element: (
          <NotBuilt
            title="Organization"
            description="Workspaces, departments and how the workforce is structured."
            planned={[
              "Workspaces, and scoping agents and missions to them",
              "Departments grouping agents by responsibility",
              "Creating and configuring agents from the UI rather than a seed script",
              "Organization membership and roles",
            ]}
          />
        ),
      },
      {
        path: "governance",
        element: (
          <NotBuilt
            title="Governance"
            description="Policies, permissions and the audit trail that constrain what agents may do."
            planned={[
              "Policies that decide which actions require approval, instead of the planner deciding per task",
              "Per-agent permission grants beyond tool authorization",
              "A queryable audit trail over the existing event log",
              "Spend and rate limits per agent and per workspace",
            ]}
          />
        ),
      },
    ],
  },
]);
