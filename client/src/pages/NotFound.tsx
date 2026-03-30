import { Link } from "wouter"
import { Button } from "../components/ui/button"
import { TrendingUp } from "lucide-react"

export default function NotFound() {
  return (
    <div className="flex h-screen flex-col items-center justify-center gap-6 bg-background text-foreground">
      <TrendingUp className="h-16 w-16 text-muted-foreground" />
      <div className="text-center">
        <h1 className="text-6xl font-bold text-muted-foreground">404</h1>
        <p className="mt-2 text-xl text-muted-foreground">Page not found</p>
      </div>
      <Link href="/">
        <Button>Go to Dashboard</Button>
      </Link>
    </div>
  )
}
