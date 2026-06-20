export type DashboardMode = "wide" | "medium" | "focused";
export type TopSplit = "focused" | "half";

export type DashboardLayout = {
  mode: DashboardMode;
  topPercent: number;
  sessionsPercent: number;
  actionRows: number;
  topSplit: TopSplit;
};

export function dashboardLayout(width: number, height: number): DashboardLayout {
  if (width < 82 || height < 22) {
    return { mode: "focused", topPercent: 0, sessionsPercent: 0, actionRows: 1, topSplit: "focused" };
  }
  if (width < 110 || height < 30) {
    return { mode: "medium", topPercent: 48, sessionsPercent: 42, actionRows: 2, topSplit: "half" };
  }
  return { mode: "wide", topPercent: 52, sessionsPercent: 40, actionRows: 1, topSplit: "half" };
}
