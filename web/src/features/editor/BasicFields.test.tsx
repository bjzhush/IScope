import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { FormProvider, useForm } from 'react-hook-form'
import { itemToForm, type ItemFormValues } from '@/lib/schema'
import { LinksAndNotes } from './BasicFields'

function Harness({ links = [] }: { links?: ItemFormValues['links'] }) {
  const form = useForm<ItemFormValues>({ defaultValues: { ...itemToForm([]), links } })
  return (
    <FormProvider {...form}>
      <LinksAndNotes />
    </FormProvider>
  )
}

test('a saved link opens in a new tab', () => {
  render(<Harness links={[{ label: '文档', url: 'https://docs.example.com' }]} />)
  const open = screen.getByRole('link', { name: '打开链接 1' })
  expect(open).toHaveAttribute('href', 'https://docs.example.com')
  expect(open).toHaveAttribute('target', '_blank')
  expect(open).toHaveAttribute('rel', 'noopener noreferrer')
})

test('a new link can be opened once its URL is valid, before saving', async () => {
  const user = userEvent.setup()
  render(<Harness />)
  await user.click(screen.getByRole('button', { name: /添加链接/ }))
  expect(screen.getByRole('button', { name: '打开链接 1' })).toBeDisabled()

  await user.type(screen.getByLabelText('链接 1 URL'), 'ftp://x')
  expect(screen.getByRole('button', { name: '打开链接 1' })).toBeDisabled()

  await user.clear(screen.getByLabelText('链接 1 URL'))
  await user.type(screen.getByLabelText('链接 1 URL'), ' https://vendor.example.com ')
  expect(screen.getByRole('link', { name: '打开链接 1' })).toHaveAttribute('href', 'https://vendor.example.com')
})
