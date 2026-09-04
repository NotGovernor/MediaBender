import FileTable from "../components/FileTable";
import TopBar from "../components/TopBar";
import BottomBar from "../components/BottomBar";
import LogPane from "../components/LogPane";

export default function DashboardPage() {
  return (
    <div class="h-full flex flex-col">
      <TopBar />
      <FileTable />
      <LogPane />
      <BottomBar />
    </div>
  );
}
