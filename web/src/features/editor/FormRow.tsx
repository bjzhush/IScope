import { Label } from '@/components/ui/label'

interface Props {
  id: string
  label: string
  required?: boolean
  error?: string
  children: React.ReactNode
}

export function FormRow({ id, label, required, error, children }: Props) {
  return (
    <div className="grid gap-1.5">
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
