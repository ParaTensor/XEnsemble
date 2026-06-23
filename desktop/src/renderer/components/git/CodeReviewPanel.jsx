import React, { useCallback, useEffect, useState } from 'react';
import { Check, CircleDot, Loader2, MessageSquare, RefreshCw, X } from 'lucide-react';
import * as gitApi from '../../lib/gitApi.js';
import { useToast } from '../Toast';
import {
  consoleIconButtonClass,
  textPrimary,
  textSecondary,
  textPlaceholder,
  borderHairline,
  bgCanvas,
} from '../../lib/consoleTheme';

const REVIEW_STATE_STYLES = {
  APPROVED: { icon: Check, bg: 'bg-green-50', text: 'text-green-700', label: 'Approved' },
  CHANGES_REQUESTED: { icon: X, bg: 'bg-red-50', text: 'text-red-700', label: 'Changes Requested' },
  COMMENTED: { icon: MessageSquare, bg: 'bg-blue-50', text: 'text-blue-700', label: 'Commented' },
  PENDING: { icon: CircleDot, bg: 'bg-yellow-50', text: 'text-yellow-700', label: 'Pending' },
  DISMISSED: { icon: X, bg: 'bg-zinc-50', text: 'text-zinc-500', label: 'Dismissed' },
};

function formatDate(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  return isNaN(d.getTime()) ? ts : d.toLocaleString();
}

function ReviewBadge({ state }) {
  const style = REVIEW_STATE_STYLES[state] || REVIEW_STATE_STYLES.COMMENTED;
  const Icon = style.icon;
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${style.bg} ${style.text}`}>
      <Icon className="h-3 w-3" />
      {style.label}
    </span>
  );
}

function ReviewItem({ review }) {
  return (
    <div className={`rounded-lg border ${borderHairline} p-3`}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          {review.user?.avatarUrl ? (
            <img src={review.user.avatarUrl} alt="" className="h-5 w-5 rounded-full" />
          ) : (
            <div className="h-5 w-5 rounded-full bg-[#E8EAED]" />
          )}
          <span className={`text-sm font-medium ${textPrimary} truncate`}>
            {review.user?.login || 'Unknown'}
          </span>
          <ReviewBadge state={review.state} />
        </div>
        <span className={`text-[10px] ${textPlaceholder} shrink-0`}>
          {formatDate(review.submittedAt)}
        </span>
      </div>
      {review.body && (
        <p className={`mt-2 text-xs ${textSecondary} whitespace-pre-wrap`}>
          {review.body}
        </p>
      )}
    </div>
  );
}

function CommentItem({ comment }) {
  return (
    <div className={`rounded-lg border ${borderHairline} p-3`}>
      <div className="flex items-center justify-between gap-2 mb-2">
        <div className="flex items-center gap-2 min-w-0">
          {comment.user?.avatarUrl ? (
            <img src={comment.user.avatarUrl} alt="" className="h-5 w-5 rounded-full" />
          ) : (
            <div className="h-5 w-5 rounded-full bg-[#E8EAED]" />
          )}
          <span className={`text-xs font-medium ${textPrimary}`}>
            {comment.user?.login || 'Unknown'}
          </span>
          <span className={`text-[10px] ${textPlaceholder}`}>
            {formatDate(comment.createdAt)}
          </span>
        </div>
      </div>

      {/* File location */}
      {comment.path && (
        <div className="mb-2 flex items-center gap-2">
          <span className="font-mono text-[10px] bg-[#F4F5F6] rounded px-1.5 py-0.5 text-[#5F6368] truncate max-w-[14rem]">
            {comment.path}
          </span>
          {comment.line && (
            <span className="font-mono text-[10px] text-[#9AA0A6]">
              L{comment.line}
            </span>
          )}
        </div>
      )}

      {/* Diff hunk */}
      {comment.diffHunk && (
        <pre className="mb-2 rounded bg-[#F4F5F6] p-2 text-[10px] font-mono text-[#5F6368] max-h-20 overflow-auto whitespace-pre-wrap">
          {comment.diffHunk}
        </pre>
      )}

      {/* Comment body */}
      <p className={`text-xs ${textSecondary} whitespace-pre-wrap`}>
        {comment.body}
      </p>
    </div>
  );
}

export default function CodeReviewPanel({ projectId, mergeRequestId }) {
  const { showToast } = useToast();
  const [reviews, setReviews] = useState([]);
  const [comments, setComments] = useState([]);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState('reviews');

  const fetchData = useCallback(async () => {
    if (!projectId || !mergeRequestId) return;
    setLoading(true);
    try {
      const [reviewsRes, commentsRes] = await Promise.all([
        gitApi.listReviews(projectId, mergeRequestId).catch(() => ({ reviews: [] })),
        gitApi.listReviewComments(projectId, mergeRequestId).catch(() => ({ comments: [] })),
      ]);
      setReviews(reviewsRes.reviews || reviewsRes || []);
      setComments(commentsRes.comments || commentsRes || []);
    } catch (err) {
      showToast('error', err.message);
    } finally {
      setLoading(false);
    }
  }, [projectId, mergeRequestId, showToast]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const approvedCount = reviews.filter((r) => r.state === 'APPROVED').length;
  const changesCount = reviews.filter((r) => r.state === 'CHANGES_REQUESTED').length;

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-[#E8EAED] px-4 py-2.5 shrink-0">
        <div className="flex items-center gap-2">
          <MessageSquare className="h-4 w-4 text-[#5F6368]" />
          <h3 className={`text-sm font-semibold ${textPrimary}`}>Code Review</h3>
          {approvedCount > 0 && (
            <span className="inline-flex items-center rounded-full bg-green-100 px-2 py-0.5 text-[10px] font-medium text-green-700">
              {approvedCount} approved
            </span>
          )}
          {changesCount > 0 && (
            <span className="inline-flex items-center rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-medium text-red-700">
              {changesCount} changes requested
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={fetchData}
          disabled={loading}
          title="Refresh reviews"
          className={consoleIconButtonClass}
        >
          {loading ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <RefreshCw className="h-3.5 w-3.5" />
          )}
        </button>
      </div>

      {/* Tab bar */}
      <div className="flex border-b border-[#E8EAED] px-4 shrink-0">
        <button
          type="button"
          onClick={() => setActiveTab('reviews')}
          className={`px-3 py-2 text-xs font-medium border-b-2 -mb-px transition-colors ${
            activeTab === 'reviews'
              ? 'border-[#202124] text-[#202124]'
              : 'border-transparent text-[#5F6368] hover:text-[#202124]'
          }`}
        >
          Reviews ({reviews.length})
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('comments')}
          className={`px-3 py-2 text-xs font-medium border-b-2 -mb-px transition-colors ${
            activeTab === 'comments'
              ? 'border-[#202124] text-[#202124]'
              : 'border-transparent text-[#5F6368] hover:text-[#202124]'
          }`}
        >
          Inline Comments ({comments.length})
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 min-h-0 overflow-auto p-4 space-y-2">
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-8 text-sm text-[#5F6368]">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading reviews…
          </div>
        ) : activeTab === 'reviews' ? (
          reviews.length === 0 ? (
            <div className="text-center py-8">
              <MessageSquare className="mx-auto h-8 w-8 text-[#9AA0A6] mb-2" />
              <p className={`text-sm ${textSecondary}`}>No reviews yet.</p>
            </div>
          ) : (
            reviews.map((review, idx) => (
              <ReviewItem key={review.id || idx} review={review} />
            ))
          )
        ) : (
          comments.length === 0 ? (
            <div className="text-center py-8">
              <MessageSquare className="mx-auto h-8 w-8 text-[#9AA0A6] mb-2" />
              <p className={`text-sm ${textSecondary}`}>No inline comments yet.</p>
            </div>
          ) : (
            comments.map((comment, idx) => (
              <CommentItem key={comment.id || idx} comment={comment} />
            ))
          )
        )}
      </div>
    </div>
  );
}
