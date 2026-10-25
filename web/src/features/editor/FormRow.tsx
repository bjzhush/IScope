import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'

interface Props {
  id: string
  label: string
  required?: boolean
  error?: string
  children: React.ReactNode
  className?: string
}

export function FormRow({ id, label, required, error, children, className }: Props) {
  return (
    <div className={cn('grid content-start gap-1.5', className)}>
      <Label htmlFor={id}>
        {label}
        {required && <span className="text-destructive">*</span>}
      </Label>
      {children}
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  )
}
