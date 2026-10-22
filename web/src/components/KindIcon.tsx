import { icons, type LucideProps } from 'lucide-react'

const toPascal = (name: string) =>
  name.replace(/(^|[-_ ])([a-z0-9])/g, (_, __, c: string) => c.toUpperCase())

// Renders a lucide icon by its kebab-case name from the kind definition.
export function KindIcon({ name, ...props }: { name: string } & LucideProps) {
  const Icon = icons[toPascal(name) as keyof typeof icons] ?? icons.Circle
  return <Icon {...props} />
}
