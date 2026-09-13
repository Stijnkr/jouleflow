import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router";
import { Layout } from "./components/Layout";
import "./index.css";
import { LiveProvider } from "./lib/live";
import { ThemeProvider } from "./lib/theme";
import { DevicesPage } from "./pages/Devices";
import { HistoryPage } from "./pages/History";
import { LivePage } from "./pages/Live";
import { P1SettingsPage } from "./pages/P1Settings";
import { SettingsPage } from "./pages/Settings";

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: true, staleTime: 5_000 } },
});

const router = createBrowserRouter([
  {
    element: <Layout />,
    children: [
      { path: "/", element: <LivePage /> },
      { path: "/history", element: <HistoryPage /> },
      { path: "/devices", element: <DevicesPage /> },
      { path: "/settings", element: <SettingsPage /> },
      { path: "/settings/p1", element: <P1SettingsPage /> },
    ],
  },
]);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <LiveProvider>
          <RouterProvider router={router} />
        </LiveProvider>
      </QueryClientProvider>
    </ThemeProvider>
  </StrictMode>,
);
