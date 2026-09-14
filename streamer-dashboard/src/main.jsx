import { StrictMode, Component } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null, info: null }
  }
  static getDerivedStateFromError(error) {
    return { error }
  }
  componentDidCatch(error, info) {
    console.error('页面渲染异常：', error, info)
    this.setState({ info })
  }
  render() {
    if (this.state.error) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-bg p-6">
          <div className="max-w-xl w-full rounded-xl border border-red-200 bg-white p-6 shadow-sm">
            <div className="text-lg font-semibold text-danger">页面渲染出错（已被错误边界捕获，不会白屏）</div>
            <p className="mt-2 text-sm text-text-secondary">
              请把下面这段错误信息发给我，我据此定位修复：
            </p>
            <pre className="mt-3 max-h-72 overflow-auto rounded-md bg-gray-50 p-3 text-xs text-text whitespace-pre-wrap">
              {String(this.state.error && this.state.error.stack || this.state.error)}
            </pre>
            {this.state.info && this.state.info.componentStack && (
              <>
                <div className="mt-3 text-sm font-medium text-danger">组件堆栈：</div>
                <pre className="mt-1 max-h-48 overflow-auto rounded-md bg-gray-50 p-3 text-xs text-text-secondary whitespace-pre-wrap">
                  {this.state.info.componentStack}
                </pre>
              </>
            )}
            <button
              onClick={() => this.setState({ error: null, info: null })}
              className="mt-4 rounded-md bg-brand-600 px-4 py-2 text-sm text-white"
            >
              重试
            </button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)
