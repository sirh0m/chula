import { cn } from '@/lib/utils';

function Card({ className, ...props }) {
  return (
    <div data-slot="card" className={cn('flex flex-col rounded-xl border bg-card text-card-foreground shadow-sm', className)} {...props} />
  );
}

function CardHeader({ className, ...props }) {
  return <div data-slot="card-header" className={cn('flex flex-col gap-1.5 p-5', className)} {...props} />;
}

function CardTitle({ className, ...props }) {
  return <div data-slot="card-title" className={cn('leading-tight font-bold', className)} {...props} />;
}

function CardDescription({ className, ...props }) {
  return <div data-slot="card-description" className={cn('text-sm text-muted-foreground', className)} {...props} />;
}

function CardContent({ className, ...props }) {
  return <div data-slot="card-content" className={cn('px-5 pb-5', className)} {...props} />;
}

function CardFooter({ className, ...props }) {
  return <div data-slot="card-footer" className={cn('flex items-center px-5 pb-5', className)} {...props} />;
}

export { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle };
