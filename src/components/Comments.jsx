import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

function showCount(value) {
  const text = String(value || '').trim()
  return text && text !== '0' ? text : ''
}

function CommentRow({ comment, replies, onToggleReplies, onMoreReplies }) {
  const likes = showCount(comment.likes)
  const replyCount = showCount(comment.replies)
  const replyLabel = replyCount
    ? `${replyCount} ${replyCount === '1' ? 'reply' : 'replies'}`
    : (comment.replyToken ? 'Replies' : '')
  return (
    <div className="flex gap-3">
      {comment.avatar ? (
        <img src={comment.avatar} alt="" className="mt-0.5 h-10 w-10 shrink-0 rounded-full object-cover" />
      ) : (
        <div className="mt-0.5 grid h-10 w-10 shrink-0 place-items-center rounded-full bg-black/[0.06] text-sm text-gray-700 dark:bg-white/10 dark:text-gray-200">
          {(comment.author || '?').replace(/^@/, '').charAt(0).toUpperCase()}
        </div>
      )}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2">
          {comment.author ? (
            <Link
              to={`/channel/${encodeURIComponent(comment.author.replace(/^@/, ''))}`}
              className="text-[13px] font-medium hover:text-yt-red"
            >
              {comment.author}
            </Link>
          ) : (
            <span className="text-[13px] font-medium">You</span>
          )}
          {comment.creator && <span className="text-[11px] font-medium text-gray-500">Creator</span>}
          {comment.time && <span className="text-xs text-gray-500 dark:text-gray-400">{comment.time}</span>}
        </div>
        {comment.text && (
          <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed">{comment.text}</p>
        )}
        <div className="mt-1.5 flex flex-wrap items-center gap-3 text-xs text-gray-500 dark:text-gray-400">
          {likes && <span>{likes}</span>}
          {replyLabel && (
            <button type="button" onClick={onToggleReplies} className="font-medium hover:text-gray-900 dark:hover:text-white">
              {replies?.open ? 'Hide replies' : replyLabel}
            </button>
          )}
        </div>
        {replies?.open && (
          <div className="mt-3 space-y-3">
            {replies.loading && <p className="text-xs text-gray-500">Loading replies…</p>}
            {replies.error && <p className="text-xs text-gray-500">{replies.error}</p>}
            {(replies.comments || []).map((reply) => (
              <CommentRow key={reply.id} comment={reply} />
            ))}
            {replies.continuation && (
              <button type="button" onClick={onMoreReplies} className="text-xs font-medium text-gray-600 hover:text-gray-900 dark:text-gray-300 dark:hover:text-white">
                {replies.loadingMore ? 'Loading…' : 'More replies'}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

export default function Comments({ videoId }) {
  const { signedIn, signingIn, signIn } = useAuth()
  const [comments, setComments] = useState([])
  const [continuation, setContinuation] = useState('')
  const [count, setCount] = useState('')
  const [sorts, setSorts] = useState([])
  const [sort, setSort] = useState('')
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState('')
  const [disabled, setDisabled] = useState('')
  const [draft, setDraft] = useState('')
  const [posting, setPosting] = useState(false)
  const [postError, setPostError] = useState('')
  const [threads, setThreads] = useState({})

  useEffect(() => {
    let cancelled = false
    setComments([])
    setContinuation('')
    setCount('')
    setSorts([])
    setSort('')
    setError('')
    setDisabled('')
    setDraft('')
    setPostError('')
    setThreads({})
    if (!videoId || !window.electronAPI?.ytComments) {
      setLoading(false)
      if (videoId && !window.electronAPI?.ytComments) setDisabled('Comments are available in the desktop app.')
      return undefined
    }
    setLoading(true)
    window.electronAPI.ytComments({ videoId }).then((res) => {
      if (cancelled) return
      setComments(res?.comments || [])
      setContinuation(res?.continuation || '')
      setCount(res?.count || '')
      setSorts(res?.sorts || [])
      setSort((res?.sorts || []).find((item) => item.selected)?.title || '')
      setDisabled(res?.disabled || '')
      setError(res?.error || '')
    }).catch(() => {
      if (!cancelled) setError('Could not load comments')
    }).finally(() => {
      if (!cancelled) setLoading(false)
    })
    return () => { cancelled = true }
  }, [videoId])

  const applyPage = (res, replace) => {
    const incoming = res?.comments || []
    setComments((prev) => {
      if (replace) return incoming
      const seen = new Set(prev.map((c) => c.id))
      return [...prev, ...incoming.filter((c) => c.id && !seen.has(c.id))]
    })
    setContinuation(res?.continuation || '')
    if (res?.disabled) setDisabled(res.disabled)
    if (res?.error) setError(res.error)
  }

  const loadMore = async () => {
    if (!continuation || loadingMore || !window.electronAPI?.ytComments) return
    setLoadingMore(true)
    try {
      const res = await window.electronAPI.ytComments({ videoId, continuation })
      applyPage(res, false)
    } catch {
      setError('Could not load more comments')
    } finally {
      setLoadingMore(false)
    }
  }

  const changeSort = async (item) => {
    if (!item?.token || item.title === sort || !window.electronAPI?.ytComments) return
    setSort(item.title)
    setLoading(true)
    setError('')
    setThreads({})
    try {
      const res = await window.electronAPI.ytComments({ videoId, continuation: item.token })
      applyPage(res, true)
      setDisabled(res?.comments?.length ? '' : (res?.disabled || ''))
    } catch {
      setError('Could not sort comments')
    } finally {
      setLoading(false)
    }
  }

  const toggleReplies = async (comment) => {
    const current = threads[comment.id]
    if (current?.open) {
      setThreads((prev) => ({ ...prev, [comment.id]: { ...current, open: false } }))
      return
    }
    if (current?.comments?.length) {
      setThreads((prev) => ({ ...prev, [comment.id]: { ...current, open: true } }))
      return
    }
    if (!comment.replyToken || !window.electronAPI?.ytComments) return
    setThreads((prev) => ({
      ...prev,
      [comment.id]: { open: true, loading: true, loadingMore: false, comments: [], continuation: '', error: '' },
    }))
    try {
      const res = await window.electronAPI.ytComments({ videoId, continuation: comment.replyToken })
      const incoming = (res?.comments || []).filter((c) => c.id !== comment.id)
      setThreads((prev) => ({
        ...prev,
        [comment.id]: {
          open: true,
          loading: false,
          loadingMore: false,
          comments: incoming,
          continuation: res?.continuation || '',
          error: incoming.length ? '' : (res?.error || ''),
        },
      }))
    } catch {
      setThreads((prev) => ({
        ...prev,
        [comment.id]: { open: true, loading: false, loadingMore: false, comments: [], continuation: '', error: 'Could not load replies' },
      }))
    }
  }

  const moreReplies = async (comment) => {
    const current = threads[comment.id]
    if (!current?.continuation || current.loadingMore || !window.electronAPI?.ytComments) return
    setThreads((prev) => ({ ...prev, [comment.id]: { ...current, loadingMore: true } }))
    try {
      const res = await window.electronAPI.ytComments({ videoId, continuation: current.continuation })
      const incoming = (res?.comments || []).filter((c) => c.id !== comment.id)
      setThreads((prev) => {
        const thread = prev[comment.id] || current
        const seen = new Set((thread.comments || []).map((c) => c.id))
        return {
          ...prev,
          [comment.id]: {
            ...thread,
            loadingMore: false,
            comments: [...(thread.comments || []), ...incoming.filter((c) => c.id && !seen.has(c.id))],
            continuation: res?.continuation || '',
          },
        }
      })
    } catch {
      setThreads((prev) => ({
        ...prev,
        [comment.id]: { ...(prev[comment.id] || current), loadingMore: false, error: 'Could not load replies' },
      }))
    }
  }

  const submit = async () => {
    const text = draft.trim()
    if (!text || posting || !window.electronAPI?.ytCommentCreate) return
    setPosting(true)
    setPostError('')
    try {
      const res = await window.electronAPI.ytCommentCreate({ videoId, text })
      if (!res?.ok) {
        setPostError(res?.reason || 'Could not post the comment')
        return
      }
      if (res.comment) {
        setComments((prev) => [res.comment, ...prev.filter((c) => c.id !== res.comment.id)])
      }
      setDraft('')
    } catch {
      setPostError('Could not post the comment')
    } finally {
      setPosting(false)
    }
  }

  return (
    <section className="mt-6" aria-label="Comments">
      <div className="flex flex-wrap items-baseline gap-2">
        <h2 className="text-lg font-semibold">Comments</h2>
        {count && <span className="text-sm text-gray-500 dark:text-gray-400">{count}</span>}
      </div>

      {sorts.length > 1 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {sorts.map((item) => (
            <button
              key={item.title}
              type="button"
              onClick={() => changeSort(item)}
              className={`rounded-full px-3 py-1 text-xs font-medium ${
                item.title === sort
                  ? 'bg-black text-white dark:bg-white dark:text-black'
                  : 'bg-black/[0.06] text-gray-700 hover:bg-black/10 dark:bg-white/10 dark:text-gray-200 dark:hover:bg-white/15'
              }`}
            >
              {item.title}
            </button>
          ))}
        </div>
      )}

      {!disabled && (
        <div className="mt-4">
          {signedIn ? (
            <div className="space-y-2">
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                rows={draft ? 3 : 1}
                maxLength={10000}
                placeholder="Add a comment..."
                className="w-full resize-none rounded-xl border border-black/10 bg-transparent px-3 py-2 text-sm outline-none focus:border-black/30 dark:border-white/15 dark:focus:border-white/30"
              />
              {draft.trim() && (
                <div className="flex items-center justify-end gap-2">
                  <button type="button" onClick={() => { setDraft(''); setPostError('') }} className="rounded-full px-3 py-1.5 text-[13px] font-medium text-gray-600 hover:bg-black/[0.04] dark:text-gray-300 dark:hover:bg-white/[0.06]">
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={submit}
                    disabled={posting}
                    className="rounded-full bg-yt-red px-3.5 py-1.5 text-[13px] font-medium text-white hover:bg-yt-red-hover disabled:opacity-60"
                  >
                    {posting ? 'Posting…' : 'Comment'}
                  </button>
                </div>
              )}
              {postError && <p className="text-xs text-gray-500">{postError}</p>}
            </div>
          ) : (
            <button
              type="button"
              onClick={() => signIn()}
              disabled={signingIn || !window.electronAPI}
              className="rounded-full border border-black/10 px-3.5 py-1.5 text-[13px] font-medium text-gray-700 hover:bg-black/[0.04] disabled:opacity-60 dark:border-white/15 dark:text-gray-200 dark:hover:bg-white/[0.06]"
            >
              {signingIn ? 'Signing in…' : 'Sign in to comment'}
            </button>
          )}
        </div>
      )}

      <div className="mt-5 space-y-4">
        {loading && (
          <div className="space-y-4">
            {[1, 2, 3].map((item) => (
              <div key={item} className="flex gap-3">
                <div className="h-10 w-10 shrink-0 rounded-full skeleton" />
                <div className="flex-1 space-y-2 py-1">
                  <div className="h-3 w-32 skeleton rounded" />
                  <div className="h-3 w-full skeleton rounded" />
                  <div className="h-3 w-2/3 skeleton rounded" />
                </div>
              </div>
            ))}
          </div>
        )}
        {!loading && error && <p className="text-sm text-gray-500">{error}</p>}
        {!loading && !error && disabled && <p className="text-sm text-gray-500">{disabled}</p>}
        {!loading && !error && !disabled && comments.length === 0 && (
          <p className="text-sm text-gray-500">No comments yet.</p>
        )}
        {!loading && comments.map((comment) => (
          <CommentRow
            key={comment.id}
            comment={comment}
            replies={threads[comment.id]}
            onToggleReplies={() => toggleReplies(comment)}
            onMoreReplies={() => moreReplies(comment)}
          />
        ))}
        {!loading && continuation && (
          <button
            type="button"
            onClick={loadMore}
            disabled={loadingMore}
            className="rounded-full bg-black/[0.06] px-4 py-2 text-sm font-medium hover:bg-black/10 disabled:opacity-60 dark:bg-white/10 dark:hover:bg-white/15"
          >
            {loadingMore ? 'Loading…' : 'Show more'}
          </button>
        )}
      </div>
    </section>
  )
}
