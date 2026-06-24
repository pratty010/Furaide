export type DashboardMode = "wide" | "medium" | "focused";
export type TopSplit = "focused" | "half";

export type DashboardLayout = {
  mode: DashboardMode;
  topPercent: number;
  sessionsPercent: number;
  actionRows: number;
  topSplit: TopSplit;
  topMaxHeight: `${number}%`;
  sessionsMinHeight: `${number}%`;
};

export function dashboardLayout(width: number, height: number): DashboardLayout {
  if (width < 60 || height < 20) {
    return { mode: "focused", topPercent: 0, sessionsPercent: 0, actionRows: 1, topSplit: "focused", topMaxHeight: "70%", sessionsMinHeight: "30%" };
  }
  if (width < 100 || height < 28) {
    return { mode: "medium", topPercent: 55, sessionsPercent: 30, actionRows: 2, topSplit: "half", topMaxHeight: "70%", sessionsMinHeight: "30%" };
  }
  return { mode: "wide", topPercent: 55, sessionsPercent: 30, actionRows: 2, topSplit: "half", topMaxHeight: "70%", sessionsMinHeight: "30%" };
}
