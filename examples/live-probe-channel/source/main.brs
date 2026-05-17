sub Main()
  screen = CreateObject("roSGScreen")
  port = CreateObject("roMessagePort")
  screen.SetMessagePort(port)
  screen.CreateScene("MainScene")
  screen.Show()

  while true
    msg = Wait(0, port)
    if Type(msg) = "roSGScreenEvent" and msg.IsScreenClosed() then
      return
    end if
  end while
end sub
