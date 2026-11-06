import type { ReactNode } from 'react';
import { Card, CardContent, Skeleton, Typography } from '@mui/material';

/** Contenedor de un reporte: título, explicación y contenido. */
export function ReportCard({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <Card>
      <CardContent>
        <Typography variant="h6" component="h2">
          {title}
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          {description}
        </Typography>
        {children}
      </CardContent>
    </Card>
  );
}

export function TableSkeleton({ rows }: { rows: number }) {
  return (
    <>
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} height={40} />
      ))}
    </>
  );
}
