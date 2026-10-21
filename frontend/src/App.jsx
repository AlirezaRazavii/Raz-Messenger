import moment from 'moment-jalaali'
import { CheckCircle2 } from 'lucide-react'

export default function App() {
  const today = moment().format('jYYYY/jMM/jDD')

  return (
    <div dir="rtl" className="min-h-screen bg-slate-100 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl p-8 max-w-md w-full text-center">
        <CheckCircle2 className="w-14 h-14 text-emerald-500 mx-auto" />
        <h1 className="text-2xl font-bold text-slate-800 mt-4">محیط توسعه آماده است</h1>
        <p className="mt-3 text-slate-500 leading-7">
          فاز صفر کامل شد؛ پستگرس و ردیس فعال هستند و این صفحه با ریکت، تیلویند و فونت وزیرمتن رندر شده است.
        </p>
        <p className="mt-4 text-sm text-slate-400">امروز: {today}</p>
      </div>
    </div>
  )
}