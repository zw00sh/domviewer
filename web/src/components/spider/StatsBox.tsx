interface StatsBoxProps {
  message: string;
}

export function StatsBox({ message }: StatsBoxProps) {
  return (
    <div className="bg-muted px-4 py-3 rounded-md text-sm">
      {message}
    </div>
  );
}
