import { screen, fireEvent, waitFor } from '@testing-library/react'
import { vi } from 'vitest'
import ChatWidget from '../components/ChatWidget'
import { renderWithProviders } from './utils'
import * as api from '../services/api'

vi.mock('../services/api', () => ({
  useChatStatus: vi.fn(),
  sendChatMessage: vi.fn(),
}))

const mockedApi = api as unknown as {
  useChatStatus: ReturnType<typeof vi.fn>
  sendChatMessage: ReturnType<typeof vi.fn>
}

describe('ChatWidget', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders nothing when the assistant is disabled', () => {
    mockedApi.useChatStatus.mockReturnValue({ data: { enabled: false, model: '' } })
    const { container } = renderWithProviders(<ChatWidget />)
    expect(container).toBeEmptyDOMElement()
  })

  it('shows the launcher when enabled and opens the panel', () => {
    mockedApi.useChatStatus.mockReturnValue({ data: { enabled: true, model: 'gemini-2.0-flash' } })
    renderWithProviders(<ChatWidget />)
    const launcher = screen.getByLabelText('Open AI assistant')
    fireEvent.click(launcher)
    expect(screen.getByText('Analytics Assistant')).toBeInTheDocument()
  })

  it('sends a message and renders the assistant reply', async () => {
    mockedApi.useChatStatus.mockReturnValue({ data: { enabled: true, model: 'gemini-2.0-flash' } })
    mockedApi.sendChatMessage.mockResolvedValue({ reply: 'Alice is doing great.', tool_calls: ['find_students'] })
    renderWithProviders(<ChatWidget />)

    fireEvent.click(screen.getByLabelText('Open AI assistant'))
    const input = screen.getByPlaceholderText('Ask a question…')
    fireEvent.change(input, { target: { value: 'How is Alice?' } })
    fireEvent.click(screen.getByLabelText('Send message'))

    expect(screen.getByText('How is Alice?')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByText('Alice is doing great.')).toBeInTheDocument())
    expect(mockedApi.sendChatMessage).toHaveBeenCalledWith([{ role: 'user', content: 'How is Alice?' }])
  })

  it('shows a clean message (backend detail) instead of the raw error', async () => {
    mockedApi.useChatStatus.mockReturnValue({ data: { enabled: true, model: 'gemini-2.0-flash' } })
    mockedApi.sendChatMessage.mockRejectedValue(
      new Error('API error 429: {"detail":"The AI assistant has reached its usage limit for now. Please wait a little while and try again."}'),
    )
    renderWithProviders(<ChatWidget />)

    fireEvent.click(screen.getByLabelText('Open AI assistant'))
    const input = screen.getByPlaceholderText('Ask a question…')
    fireEvent.change(input, { target: { value: 'hi' } })
    fireEvent.click(screen.getByLabelText('Send message'))

    await waitFor(() => expect(screen.getByText(/reached its usage limit/)).toBeInTheDocument())
    // The raw status / JSON body must NOT be shown to the user.
    expect(screen.queryByText(/API error 429/)).not.toBeInTheDocument()
    expect(screen.queryByText(/"detail"/)).not.toBeInTheDocument()
  })

  it('falls back to a friendly message when there is no detail', async () => {
    mockedApi.useChatStatus.mockReturnValue({ data: { enabled: true, model: 'gemini-2.0-flash' } })
    mockedApi.sendChatMessage.mockRejectedValue(new Error('API error 502: boom'))
    renderWithProviders(<ChatWidget />)

    fireEvent.click(screen.getByLabelText('Open AI assistant'))
    const input = screen.getByPlaceholderText('Ask a question…')
    fireEvent.change(input, { target: { value: 'hi' } })
    fireEvent.click(screen.getByLabelText('Send message'))

    await waitFor(() => expect(screen.getByText(/temporarily unavailable/)).toBeInTheDocument())
  })
})
