"use client";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
} from "recharts";
export default function ReportChart({
  data,
}: {
  data: { day: string; inbound: number; outbound: number }[];
}) {
  return (
    <div className="chart" dir="ltr">
      <ResponsiveContainer width="100%" height={280}>
        <AreaChart
          data={data}
          margin={{ top: 10, right: 15, bottom: 0, left: 0 }}
        >
          <defs>
            <linearGradient id="incoming" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#12836b" stopOpacity={0.22} />
              <stop offset="100%" stopColor="#12836b" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} stroke="#edf0ef" />
          <XAxis
            dataKey="day"
            tickLine={false}
            axisLine={false}
            tick={{ fontSize: 11, fill: "#7a8883" }}
          />
          <YAxis
            allowDecimals={false}
            tickLine={false}
            axisLine={false}
            tick={{ fontSize: 11, fill: "#7a8883" }}
          />
          <Tooltip />
          <Legend />
          <Area
            type="monotone"
            dataKey="inbound"
            name="دریافتی"
            stroke="#12836b"
            fill="url(#incoming)"
            strokeWidth={2.5}
          />
          <Area
            type="monotone"
            dataKey="outbound"
            name="ارسالی"
            stroke="#cba860"
            fill="transparent"
            strokeWidth={2}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
