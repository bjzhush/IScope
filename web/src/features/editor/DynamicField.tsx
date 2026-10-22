import { ChevronsUpDown } from 'lucide-react'
import { useController, useFormContext } from 'react-hook-form'
import type { Field, Option } from '@/api/types'
import { Button } from '@/components/ui/button'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import { Input } from '@/components/ui/input'
import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupText } from '@/components/ui/input-group'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import type { FormAttrValue, ItemFormValues } from '@/lib/schema'
import { FormRow } from './FormRow'

// Options below this count render as a toggle group, otherwise a searchable popover.
const TOGGLE_MAX_OPTIONS = 6

// Renders one kind-specific attrs field purely from its definition.
export function DynamicField({ field }: { field: Field }) {
  const name = `attrs.${field.key}` as const
  const { control } = useFormContext<ItemFormValues>()
  const { field: ctl, fieldState } = useController({ control, name })
  const id = `field-${name}`

  return (
    <FormRow id={id} label={field.label} required={field.required} error={fieldState.error?.message}>
      <FieldControl
        field={field}
        id={id}
        value={ctl.value}
        onChange={ctl.onChange}
        onBlur={ctl.onBlur}
        invalid={!!fieldState.error}
      />
    </FormRow>
  )
}

interface ControlProps {
  field: Field
  id: string
  value: FormAttrValue
  onChange: (v: FormAttrValue) => void
  onBlur?: () => void
  invalid?: boolean
}

// The input for one field type, independent of any form library.
export function FieldControl({ field, id, value, onChange, onBlur, invalid = false }: ControlProps) {
  let input: React.ReactNode
  switch (field.type) {
    case 'text':
    case 'url':
    case 'date':
      input = (
        <Input
          id={id}
          type={field.type === 'text' ? 'text' : field.type}
          placeholder={field.placeholder}
          aria-invalid={invalid}
          value={value as string}
          onChange={(e) => onChange(e.target.value)}
          onBlur={onBlur}
        />
      )
      break
    case 'textarea':
      input = (
        <Textarea
          id={id}
          placeholder={field.placeholder}
          aria-invalid={invalid}
          value={value as string}
          onChange={(e) => onChange(e.target.value)}
          onBlur={onBlur}
        />
      )
      break
    case 'number':
      input = (
        <InputGroup>
          <InputGroupInput
            id={id}
            type="number"
            inputMode={field.integer ? 'numeric' : 'decimal'}
            step={field.integer ? 1 : 'any'}
            min={field.min}
            placeholder={field.placeholder}
            aria-invalid={invalid}
            value={value as string}
            onChange={(e) => onChange(e.target.value)}
            onBlur={onBlur}
          />
          {field.unit && (
            <InputGroupAddon align="inline-end">
              <InputGroupText>{field.unit}</InputGroupText>
            </InputGroupAddon>
          )}
        </InputGroup>
      )
      break
    case 'bool':
      input = (
        <Switch id={id} aria-invalid={invalid} checked={value === true} onCheckedChange={onChange} />
      )
      break
    case 'select':
      input = (
        <SelectField id={id} options={field.options ?? []} value={value as string} onChange={onChange} invalid={invalid} />
      )
      break
    case 'multiselect': {
      const props = {
        id,
        label: field.label,
        options: field.options ?? [],
        value: value as string[],
        onChange,
      }
      input =
        props.options.length < TOGGLE_MAX_OPTIONS ? <MultiToggle {...props} /> : <MultiPopover {...props} />
      break
    }
  }

  return input
}

function SelectField(props: {
  id: string
  options: Option[]
  value: string
  onChange: (v: string) => void
  invalid: boolean
}) {
  const items = [{ value: null, label: '未设置' }, ...props.options]
  return (
    <Select items={items} value={props.value || null} onValueChange={(v) => props.onChange((v as string | null) ?? '')}>
      <SelectTrigger id={props.id} className="w-full" aria-invalid={props.invalid}>
        <SelectValue placeholder="未设置" />
      </SelectTrigger>
      <SelectContent>
        {items.map((o) => (
          <SelectItem key={o.value ?? ''} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

interface MultiProps {
  id: string
  label: string
  options: Option[]
  value: string[]
  onChange: (v: string[]) => void
}

// Keeps the stored order equal to the option order.
const ordered = (options: Option[], values: string[]) =>
  options.map((o) => o.value).filter((v) => values.includes(v))

function MultiToggle({ id, label, options, value, onChange }: MultiProps) {
  return (
    <ToggleGroup
      id={id}
      aria-label={label}
      multiple
      variant="outline"
      size="sm"
      className="flex-wrap"
      value={value}
      onValueChange={(v) => onChange(ordered(options, v as string[]))}
    >
      {options.map((o) => (
        <ToggleGroupItem key={o.value} value={o.value}>
          {o.label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  )
}

function MultiPopover({ id, label, options, value, onChange }: MultiProps) {
  const toggle = (v: string) =>
    onChange(ordered(options, value.includes(v) ? value.filter((x) => x !== v) : [...value, v]))
  const summary = value.map((v) => options.find((o) => o.value === v)?.label ?? v).join('、')
  return (
    <Popover>
      <PopoverTrigger render={<Button id={id} variant="outline" className="w-full justify-between font-normal" />}>
        <span className="truncate">{summary || '未设置'}</span>
        <ChevronsUpDown className="opacity-50" />
      </PopoverTrigger>
      <PopoverContent className="w-(--anchor-width) p-0">
        <Command>
          <CommandInput placeholder={`搜索${label}`} />
          <CommandList>
            <CommandEmpty>没有匹配的选项</CommandEmpty>
            <CommandGroup>
              {options.map((o) => (
                <CommandItem key={o.value} value={o.label} data-checked={value.includes(o.value)} onSelect={() => toggle(o.value)}>
                  {o.label}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
