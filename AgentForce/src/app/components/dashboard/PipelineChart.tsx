import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";
import { AppCard } from "../primitives";
import { ChartTooltip } from "./ChartTooltip";

export function PipelineChart({ data }: { data: { stage: string; count: number }[] }) {
  return (
    <AppCard className="lg:col-span-2 p-5">
      <div className="flex items-center justify-between mb-5">
        <h3 className="text-sm font-semibold text-foreground">Pipeline Stages</h3>
      </div>
      <ResponsiveContainer width="100%" height={150}>
        <BarChart data={data} margin={{ top: 4, right: 4, left: -24, bottom: 0 }}>
          <CartesianGrid stroke="#f0ede9" strokeDasharray="0" vertical={false} />
          <XAxis dataKey="stage" tick={{ fill: "#717171", fontSize: 10 }} axisLine={false} tickLine={false} />
          <YAxis tick={{ fill: "#717171", fontSize: 11 }} axisLine={false} tickLine={false} allowDecimals={false} />
          <Tooltip content={<ChartTooltip />} cursor={{ fill: "#f7f5f2" }} />
          <Bar dataKey="count" name="count" fill="#e8442a" fillOpacity={0.85} radius={[6, 6, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </AppCard>
  );
}
