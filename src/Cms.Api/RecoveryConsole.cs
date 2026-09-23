namespace Cms.Api;

/// <summary>Server-console password entry without command-line or configuration secrets.</summary>
public static class RecoveryConsole
{
    /// <summary>Read and confirm a bounded password; interactive input is not echoed.</summary>
    public static string ReadPassword()
    {
        Console.WriteLine("请先停止正在运行的 API 实例。密码为 12–200 个字符，不会显示或写入配置。");
        var password = Read("新密码：");
        if (password != Read("再次输入：")) throw new InvalidOperationException("两次密码不一致，未修改账号。");
        if (password.Length is < 12 or > 200) throw new InvalidOperationException("密码须为 12–200 个字符。");
        return password;
    }

    private static string Read(string prompt)
    {
        Console.Write(prompt);
        var value = new System.Text.StringBuilder();
        if (Console.IsInputRedirected)
        {
            int next;
            while ((next = Console.Read()) != -1 && next != '\n')
            {
                if (next == '\r') continue;
                if (value.Length >= 200) throw new InvalidOperationException("密码过长。");
                value.Append((char)next);
            }
        }
        else
        {
            while (true)
            {
                var key = Console.ReadKey(true);
                if (key.Key == ConsoleKey.Enter) break;
                if (key.Key == ConsoleKey.Backspace) { if (value.Length > 0) value.Length--; }
                else if (!char.IsControl(key.KeyChar))
                {
                    if (value.Length >= 200) throw new InvalidOperationException("密码过长。");
                    value.Append(key.KeyChar);
                }
            }
        }
        Console.WriteLine();
        return value.ToString();
    }
}
