import { ReviewList } from "./pages/ReviewList";
import { Review } from "./pages/Review";

export function App() {
  const match = window.location.pathname.match(/^\/review\/([^/]+)/);
  if (match) return <Review threadId={match[1]} />;
  return <ReviewList />;
}
