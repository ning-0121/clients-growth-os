/**
 * Shared MetricCard component used across dashboard pages.
 */
export default function MetricCard({
  label,
  value,
  color = 'text-gray-900',
  border = 'border-gray-200',
}: {
  label: string;
  value: number | string;
  color?: string;
  border?: string;
}) {
  return (
    <div className={`bg-white rounded-lg border p-4 text-center ${border}`}>
      <div className={`text-2xl font-bold ${color}`}>{value}</div>
      <div className="text-xs text-gray-500">{label}</div>
    </div>
  );
}
