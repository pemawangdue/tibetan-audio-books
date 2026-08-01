import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import { resetMockApi } from './api'
import App from './App'

const mockUser = { id: 'test-user', email: 'reader@example.org', name: 'Reader' }

describe('dadhep frontend', () => {
  beforeEach(() => {
    localStorage.setItem('dadhep.mock-user', JSON.stringify(mockUser))
    resetMockApi()
  })

  it('shows My Uploads and keeps shared publishing unavailable', async () => {
    window.history.pushState({}, '', '/library')
    const user = userEvent.setup()
    render(<App />)
    expect(await screen.findByText('A Path of Compassion')).toBeVisible()
    await user.click(screen.getByRole('tab', { name: 'Shared with me' }))
    expect(screen.getByText('Shared library coming later')).toBeVisible()
  })

  it('accepts a PDF and starts a presigned upload flow', async () => {
    window.history.pushState({}, '', '/upload')
    const user = userEvent.setup()
    render(<App />)
    const file = new File(['book'], 'practice.pdf', { type: 'application/pdf' })
    await user.upload(screen.getByLabelText(/choose files/i), file)
    expect(screen.getByText('practice.pdf')).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Upload and create audio' }))
    await waitFor(() => expect(window.location.pathname).toMatch(/^\/jobs\//))
  })

  it('highlights an active sentence and opens correction flow', async () => {
    window.history.pushState({}, '', '/books/sample/read')
    const user = userEvent.setup()
    render(<App />)
    const sentence = await screen.findByText('བྱམས་པ་ནི་ང་ཚོའི་ལམ་ཡིན །')
    await user.click(sentence)
    expect(sentence).toHaveClass('active')
    await user.dblClick(sentence)
    expect(screen.getByRole('dialog', { name: 'Correct this sentence' })).toBeVisible()
    const textbox = screen.getByRole('textbox', { name: 'Corrected text' })
    await user.clear(textbox)
    await user.type(textbox, 'བྱམས་པ་ནི་ལམ་ཡིན །')
    expect(screen.getByRole('button', { name: 'Submit correction' })).toBeEnabled()
  })

  it('persists the Tibetan interface language', async () => {
    window.history.pushState({}, '', '/settings')
    const user = userEvent.setup()
    render(<App />)
    await user.selectOptions(await screen.findByRole('combobox', { name: 'Language' }), 'bo')
    expect(localStorage.getItem('dadhep.language')).toBe('bo')
    expect(screen.getByText('དཔེ་མཛོད།')).toBeVisible()
  })

  it('deletes a book from the details page after confirmation', async () => {
    window.history.pushState({}, '', '/books/sample')
    const user = userEvent.setup()
    render(<App />)
    expect(await screen.findByRole('heading', { name: 'A Path of Compassion' })).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Delete book' }))
    const dialog = screen.getByRole('dialog', { name: 'Delete book' })
    expect(dialog).toBeVisible()
    await user.click(within(dialog).getByRole('button', { name: 'Delete book' }))
    await waitFor(() => expect(window.location.pathname).toBe('/library'))
    expect(await screen.findByText('Your listening library starts here')).toBeVisible()
  })
})
