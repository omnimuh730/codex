import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";
import { AppCard } from "../primitives";
import { ChartTooltip } from "./ChartTooltip";

export function ApplicationsChart({ data, applied7d }: {
  data: { day: string; date: string; count: number }[];
  applied7d?: number;
}) {
  return (
    <AppCard className="lg:col-span-3 p-5">
      <div className="flex items-center justify-between mb-5">
        <h3 className="text-sm font-semibold text-foreground">7-Day Submissions</h3>
        {applied7d != null && applied7d > 0 && (
          <span className="text-xs text-muted-foreground font-medium bg-secondary border border-border px-2.5 py-1 rounded-full">
            {applied7d} this week
          </span>
        )}
      </div>
      <ResponsiveContainer width="100%" height={150}>
        <AreaChart data={data} margin={{ top: 4, right: 4, left: -24, bottom: 0 }}>
          <defs>
            <linearGradient id="winGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#e8442a" stopOpacity={0.15} />
              <stop offset="95%" stopColor="#e8442a" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="#f0ede9" strokeDasharray="0" vertical={false} />
          <XAxis dataKey="day" tick={{ fill: "#717171", fontSize: 11 }} axisLine={false} tickLine={false} />
          <YAxis tick={{ fill: "#717171", fontSize: 11 }} axisLine={false} tickLine={false} allowDecimals={false} />
          <Tooltip content={<ChartTooltip />} cursor={{ stroke: "#e3dfd9", strokeWidth: 1 }} />
          <Area
            type="monotone"
            dataKey="count"
            name="submissions"
            stroke="#e8442a"
            strokeWidth={2}
            fill="url(#winGrad)"
            dot={false}
            activeDot={{ r: 4, fill: "#e8442a", stroke: "#fff", strokeWidth: 2 }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </AppCard>
  );
}
