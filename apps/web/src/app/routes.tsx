import {
  createBrowserRouter,
} from "react-router-dom";

import App from "../App";
import Command from "../pages/Command";
import PlaceholderPage from "../pages/PlaceholderPage";

export const router =
  createBrowserRouter([
    {
      path: "/",
      element: <App />,
      children: [
        {
          index: true,
          element: <Command />,
        },

        {
          path: "command",
          element: <Command />,
        },

        {
          path: "work",
          element: (
            <PlaceholderPage title="Work" />
          ),
        },

        {
          path: "agents",
          element: (
            <PlaceholderPage title="Agents" />
          ),
        },

        {
          path: "tools",
          element: (
            <PlaceholderPage title="Tools" />
          ),
        },

        {
          path: "brain",
          element: (
            <PlaceholderPage title="Company Brain" />
          ),
        },

        {
          path: "artifacts",
          element: (
            <PlaceholderPage title="Artifacts" />
          ),
        },

        {
          path: "approvals",
          element: (
            <PlaceholderPage title="Approvals" />
          ),
        },

        {
          path: "activity",
          element: (
            <PlaceholderPage title="Activity" />
          ),
        },

        {
          path: "organization",
          element: (
            <PlaceholderPage title="Organization" />
          ),
        },

        {
          path: "governance",
          element: (
            <PlaceholderPage title="Governance" />
          ),
        },
      ],
    },
  ]);