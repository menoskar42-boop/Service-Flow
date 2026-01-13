import { Badge } from "@/components/ui/badge";

export function StatusBadge({ status, feasible }: { status: string, feasible?: boolean | null }) {
  if (status === "pending") {
    return (
      <Badge variant="outline" className="badge-warning px-3 py-1 text-xs uppercase tracking-wide">
        Pending Review
      </Badge>
    );
  }

  if (status === "feasible" || feasible === true) {
    return (
      <Badge variant="outline" className="badge-success px-3 py-1 text-xs uppercase tracking-wide">
        Feasible
      </Badge>
    );
  }

  return (
    <Badge variant="outline" className="badge-destructive px-3 py-1 text-xs uppercase tracking-wide">
      Not Feasible
    </Badge>
  );
}
