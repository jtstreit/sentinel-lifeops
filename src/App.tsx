import ErrorBoundary from "./ErrorBoundary";
import LifeOpsApp from "./LifeOpsApp";

export default function App() {
  return (
    <ErrorBoundary>
      <LifeOpsApp />
    </ErrorBoundary>
  );
}
