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
  if (width < 82 || height < 22) {
    return { mode: "focused", topPercent: 0, sessionsPercent: 0, actionRows: 1, topSplit: "focused", topMaxHeight: "55%", sessionsMinHeight: "30%" };
  }
  if (width < 110 || height < 30) {
    return { mode: "medium", topPercent: 1, sessionsPercent: 1, actionRows: 2, topSplit: "half", topMaxHeight: "55%", sessionsMinHeight: "30%" };
  }
  return { mode: "wide", topPercent: 1, sessionsPercent: 1, actionRows: 2, topSplit: "half", topMaxHeight: "55%", sessionsMinHeight: "30%" };
}
