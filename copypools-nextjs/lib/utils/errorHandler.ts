/**
 * Error handler utility for structured backend error responses
 */

export interface StructuredError {
  statusCode: number
  timestamp: string
  path: string
  method: string
  error: string | { message: string; [key: string]: any }
}

export const parseError = (error: any): string => {
  // Handle axios errors with structured response
  if (error.response?.data) {
    const data = error.response.data
    
    // Check if it's a structured error from our backend
    if (data.error) {
      if (typeof data.error === 'string') {
        return data.error
      } else if (data.error.message) {
        return data.error.message
      }
    }
    
    // Fallback to status text or message
    return data.message || error.response.statusText || 'An error occurred'
  }
  
  // Handle network errors
  if (error.message) {
    if (error.message.includes('Network Error') || error.message.includes('timeout')) {
      return 'Network error: Unable to connect to backend. Please check your connection.'
    }
    return error.message
  }
  
  return 'An unexpected error occurred'
}

export const getErrorStatus = (error: any): number | null => {
  return error.response?.status || error.response?.data?.statusCode || null
}

export const isRateLimitError = (error: any): boolean => {
  return getErrorStatus(error) === 429
}

export const getRetryAfter = (error: any): number | null => {
  if (isRateLimitError(error)) {
    return error.response?.data?.retryAfter || null
  }
  return null
}

