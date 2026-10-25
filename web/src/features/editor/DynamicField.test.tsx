import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { FormProvider, useForm } from 'react-hook-form'
import type { Field } from '@/api/types'
import { attrsToForm, itemToForm, type ItemFormValues } from '@/lib/schema'
import { DynamicField } from './DynamicField'
import { fieldSpan } from './layout'

let latest: ItemFormValues | undefined

function Harness({ field, value }: { field: Field; value?: unknown }) {
  const defaults = itemToForm([field])
  defaults.attrs = attrsToForm([field], value === undefined ? {} : { [field.key]: value as never })
  const form = useForm<ItemFormValues>({ defaultValues: defaults })
  latest = form.watch()
  return (
    <FormProvider {...form}>
      <DynamicField field={field} />
    </FormProvider>
  )
}

const opts = (...v: string[]) => v.map((x) => ({ value: x, label: x.toUpperCase() }))

describe('DynamicField', () => {
  it('text → input with label and placeholder', async () => {
    render(<Harness field={{ key: 'vendor', label: '出品方', type: 'text', required: true, placeholder: 'who' }} />)
    const input = screen.getByLabelText(/出品方/)
    expect(input).toHaveAttribute('type', 'text')
    expect(input).toHaveAttribute('placeholder', 'who')
    expect(screen.getByText('*')).toBeInTheDocument()
    await userEvent.type(input, 'Anthropic')
    expect(latest?.attrs.vendor).toBe('Anthropic')
  })

  it('textarea → textarea', () => {
    render(<Harness field={{ key: 'x', label: '说明', type: 'textarea' }} />)
    expect(screen.getByLabelText('说明').tagName).toBe('TEXTAREA')
  })

  it('number → number input with unit suffix', async () => {
    render(<Harness field={{ key: 'ctx', label: '上下文', type: 'number', unit: 'tokens', integer: true, min: 1 }} value={1000} />)
    const input = screen.getByLabelText('上下文')
    expect(input).toHaveAttribute('type', 'number')
    expect(input).toHaveValue(1000)
    expect(screen.getByText('tokens')).toBeInTheDocument()
  })

  it('bool → switch', async () => {
    render(<Harness field={{ key: 'oss', label: '开源', type: 'bool' }} />)
    const sw = screen.getByRole('switch')
    expect(sw).not.toBeChecked()
    await userEvent.click(sw)
    expect(latest?.attrs.oss).toBe(true)
  })

  it('select → combobox showing the option label', () => {
    render(<Harness field={{ key: 'form', label: '形态', type: 'select', options: opts('cli', 'ide') }} value="ide" />)
    expect(screen.getByRole('combobox')).toHaveTextContent('IDE')
  })

  it('multiselect with few options → toggle group', async () => {
    render(<Harness field={{ key: 'm', label: '模态', type: 'multiselect', options: opts('text', 'image', 'pdf') }} value={['pdf']} />)
    const group = screen.getByRole('group', { name: '模态' })
    expect(group).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'TEXT' }))
    // Stored in option order, not click order.
    expect(latest?.attrs.m).toEqual(['text', 'pdf'])
  })

  it('multiselect with many options → popover trigger summarising the selection', () => {
    render(
      <Harness field={{ key: 'm', label: '模态', type: 'multiselect', options: opts('a', 'b', 'c', 'd', 'e', 'f') }} value={['b', 'd']} />,
    )
    expect(screen.queryByRole('group', { name: '模态' })).toBeNull()
    expect(screen.getByRole('button', { name: '模态' })).toHaveTextContent('B、D')
  })

  it('date → date input', () => {
    render(<Harness field={{ key: 'd', label: '发布日期', type: 'date' }} value="2026-10-21" />)
    const input = screen.getByLabelText('发布日期')
    expect(input).toHaveAttribute('type', 'date')
    expect(input).toHaveValue('2026-10-21')
  })

  it('url → url input', () => {
    render(<Harness field={{ key: 'u', label: 'Base URL', type: 'url' }} />)
    expect(screen.getByLabelText('Base URL')).toHaveAttribute('type', 'url')
  })
})

test('only multi-line text spans both grid columns', () => {
  const types = ['text', 'textarea', 'number', 'bool', 'select', 'multiselect', 'date', 'url'] as const
  const wide = types.filter((type) => fieldSpan({ key: 'k', label: 'l', type }))
  expect(wide).toEqual(['textarea'])
})
